import { serveDashboardHtml } from "./dashboard";
import {
  buildControlActionRows,
  getCloseModal,
  getCommentModal,
  getCreateIssueModal,
  parseIssueCommand,
  respondInteraction,
  sendDiscordMessage,
} from "./discord";
import { DiscordGateway } from "./gateway";
import {
  addIssueComment,
  closeGitHubIssue,
  createProjectDraftIssue,
  fetchProjectIssues,
  findIssueByNumber,
} from "./github";
import { logEvent, LogStore } from "./logger";
import { DiscordInteraction, DiscordMessage, Env } from "./types";
import { getInternalGatewayToken, isRateLimited, sanitizeOutput } from "./security";

export { DiscordGateway, LogStore };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Panel de logs público (sin contraseña)
    if (path === "/" || path === "/logs" || path === "/index.html") {
      return serveDashboardHtml();
    }

    // API de Logs
    if (path === "/api/logs") {
      const store = env.LOG_STORE.get(env.LOG_STORE.idFromName("global"));
      if (request.method === "GET") {
        return await store.fetch(new Request("https://internal/logs"));
      }
      if (request.method === "DELETE") {
        return await store.fetch(new Request("https://internal/clear", { method: "DELETE" }));
      }
    }

    // API de Estado
    if (path === "/api/status") {
      return await handleStatus(env);
    }

    // API de Reconexión Gateway
    if (path === "/api/connect" && request.method === "POST") {
      return await handleConnect(env, url);
    }

    // Eventos internos del Gateway
    if (path === "/discord/events") {
      return await handleDiscordEvents(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleDiscordEvents(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.headers.get("x-issuebot-gateway") !== "gateway-event") {
    return new Response("Unauthorized", { status: 401 });
  }

  const expectedToken = await getInternalGatewayToken(env);
  const providedToken = request.headers.get("x-issuebot-token");
  if (!providedToken || providedToken !== expectedToken) {
    return new Response("Forbidden: Invalid internal gateway token", { status: 403 });
  }

  const body = (await request.json()) as { event: string; data: any };

  if (body.event === "MESSAGE_CREATE") {
    ctx.waitUntil(processMessage(env, body.data as DiscordMessage));
  } else if (body.event === "INTERACTION_CREATE") {
    ctx.waitUntil(processInteraction(env, body.data as DiscordInteraction));
  }

  return new Response("ok");
}

function getHelpMessage(): string {
  return (
    `🤖 **IssueBot — Asistente de Proyectos y Gestión de Issues**\n\n` +
    `**✨ Interfaz Interactiva:**\n` +
    `Usa los botones de abajo para filtrar temas o abrir los formularios modales:\n` +
    `• **➕ Nueva Issue**: Abre el formulario para registrar un bug o sugerencia.\n` +
    `• **💬 Comentar**: Añade un comentario o avance a una issue abierta.\n` +
    `• **🔒 Cerrar Issue**: Marca como resuelta una issue en GitHub.\n` +
    `• **🚀 Pulsar OS / 🏢 InledGroup**: Filtra las tareas de cada organización.\n\n` +
    `**⚡ Comandos Rápidos por Texto:**\n` +
    `• \`!issue help\` o \`@IssueBot help\` ➔ Abre este panel interactivo.\n` +
    `• \`@IssueBot view pulsar\` ➔ Muestra todas las issues de Pulsar OS.\n` +
    `• \`@IssueBot view pulsar errors\` ➔ Solo errores de Pulsar.\n` +
    `• \`@IssueBot view pulsar ideas\` ➔ Solo ideas/sugerencias de Pulsar.\n` +
    `• \`@IssueBot view inled\` ➔ Muestra las issues de InledGroup.\n` +
    `• \`@IssueBot pulsar error <descripción>\` ➔ Crea un error en Pulsar.\n` +
    `• \`@IssueBot pulsar idea <descripción>\` ➔ Añade una sugerencia a Pulsar.\n` +
    `• \`@IssueBot inled error <descripción>\` ➔ Crea un error en InledGroup.\n` +
    `• \`@IssueBot comment #223 <mensaje>\` ➔ Comenta directamente en la issue #223.\n` +
    `• \`@IssueBot close #223 [motivo opcional]\` ➔ Cierra la issue #223 en GitHub.\n\n` +
    `🔗 **Pulsar OS Board:** <https://github.com/orgs/Inled-Pulsar-OS/projects/1/views/2>\n` +
    `🔗 **InledGroup Board:** <https://github.com/orgs/InledGroup/projects/1/views/1>`
  );
}

function getModalValue(components: any[] | undefined, customId: string): string {
  if (!components) return "";
  for (const row of components) {
    if (row.components) {
      for (const comp of row.components) {
        if (comp.custom_id === customId) {
          return comp.value?.trim() || "";
        }
      }
    }
  }
  return "";
}

/**
 * Handles Interactive Component clicks and Modal Submissions from Discord
 */
async function processInteraction(env: Env, interaction: DiscordInteraction): Promise<void> {
  const user = interaction.user || interaction.member?.user;
  const authorName = user?.global_name || user?.username || "DiscordUser";
  const customId = interaction.data?.custom_id || "";

  // 1. CLICK EN BOTÓN (Component Type 2)
  if (interaction.type === 3) {
    if (customId === "action:open_create_modal") {
      await respondInteraction(env, interaction.id, interaction.token, getCreateIssueModal());
      return;
    }

    if (customId === "action:open_comment_modal") {
      await respondInteraction(env, interaction.id, interaction.token, getCommentModal());
      return;
    }

    if (customId === "action:open_close_modal") {
      await respondInteraction(env, interaction.id, interaction.token, getCloseModal());
      return;
    }

    if (customId === "action:show_help") {
      await respondInteraction(env, interaction.id, interaction.token, {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: getHelpMessage(),
          components: buildControlActionRows(),
        },
      });
      return;
    }

    // Botones de filtro: filter:pulsar:all, filter:pulsar:Error, filter:inled:all, etc.
    if (customId.startsWith("filter:")) {
      const parts = customId.split(":");
      const org = (parts[1] === "inled" ? "inled" : "pulsar") as "pulsar" | "inled";
      const filterType = parts[2] === "all" ? undefined : parts[2];

      try {
        const { items, boardUrl, orgName } = await fetchProjectIssues(env, org, filterType);
        const filterHeader = filterType ? ` [${filterType}]` : "";
        const lines = items.map((it, idx) => {
          const numStr = it.number ? `[#${it.number}] ` : "";
          const icon = it.type === "Error" ? "🐛" : it.type === "Idea" ? "💡" : it.type === "Ayuda" ? "🤝" : "📌";
          const typeStr = it.type ? `*${icon} [${it.type}]* ` : "";
          return `${idx + 1}. ${typeStr}${numStr}**${it.title}**\n   🔗 <${it.url}>`;
        });

        const replyContent =
          lines.length === 0
            ? `ℹ️ No open issues found on **${orgName}**${filterHeader}.\n\n👉 **Tablero completo:** <${boardUrl}>`
            : `📋 **${orgName} — Issues abiertas${filterHeader} (${items.length}):**\n\n${lines.join("\n\n")}\n\n👉 **Tablero completo:** <${boardUrl}>`;

        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: {
            content: replyContent,
            components: buildControlActionRows(),
          },
        });
      } catch (err) {
        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: {
            content: `❌ Error al consultar issues: ${sanitizeOutput(String(err))}`,
          },
        });
      }
      return;
    }
  }

  // 2. ENVÍO DE FORMULARIO MODAL (Type 5)
  if (interaction.type === 5) {
    const components = interaction.data?.components;

    // Modal Crear Issue
    if (customId === "modal_submit_create") {
      const orgInput = getModalValue(components, "org").toLowerCase();
      const org: "pulsar" | "inled" = orgInput.includes("inled") ? "inled" : "pulsar";
      const typeInput = getModalValue(components, "type").toLowerCase();
      const type: "Error" | "Idea" = typeInput.includes("idea") || typeInput.includes("suggestion") ? "Idea" : "Error";
      const title = getModalValue(components, "title") || "Untitled issue";
      const details = getModalValue(components, "details");
      const body = `Reported via Discord Modal by @${authorName}\n\n${details || title}`;

      try {
        const res = await createProjectDraftIssue(env, org, title, body, type);
        const typeEmoji = type === "Error" ? "🐛" : "💡";
        const replyText =
          `✅ **Issue creada con éxito mediante formulario interactivo!**\n\n` +
          `• **Organización:** ${res.orgName}\n` +
          `• **Tipo:** ${typeEmoji} **${type}**\n` +
          `• **Título:** ${title}\n` +
          `• **Creado por:** <@${user?.id}>\n\n` +
          `👉 **Ver en Project Board:** <${res.boardUrl}>`;

        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: {
            content: replyText,
            components: buildControlActionRows(),
          },
        });

        await logEvent(env, {
          level: "SUCCESS",
          event: "MODAL_ISSUE_CREATED",
          user: `@${authorName}`,
          org: res.orgName as any,
          message: `Created ${type} via Modal: "${title}"`,
        });
      } catch (err) {
        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: {
            content: `❌ Error al crear issue: ${sanitizeOutput(String(err))}`,
          },
        });
      }
      return;
    }

    // Modal Comentar
    if (customId === "modal_submit_comment") {
      const numRaw = getModalValue(components, "number").replace(/#/g, "");
      const issueNum = parseInt(numRaw, 10);
      const commentText = getModalValue(components, "comment");

      if (isNaN(issueNum) || !commentText) {
        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: { content: "⚠️ Por favor indica un número de issue válido y un comentario." },
        });
        return;
      }

      try {
        const resolved = await findIssueByNumber(env, issueNum);
        const { commentUrl } = await addIssueComment(
          env,
          resolved.owner,
          resolved.repo,
          resolved.number,
          commentText,
          authorName
        );

        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: {
            content:
              `💬 **Comentario añadido con éxito en #${resolved.number}!**\n\n` +
              `> ${commentText.slice(0, 200)}\n\n` +
              `🔗 <${commentUrl}>`,
            components: buildControlActionRows(),
          },
        });

        await logEvent(env, {
          level: "SUCCESS",
          event: "ISSUE_COMMENTED",
          user: `@${authorName}`,
          org: resolved.owner === "InledGroup" ? "InledGroup" : "Inled-Pulsar-OS",
          message: `Commented on #${resolved.number}: "${commentText.slice(0, 60)}"`,
        });
      } catch (err) {
        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: { content: `❌ Error al comentar en la issue: ${sanitizeOutput(String(err))}` },
        });
      }
      return;
    }

    // Modal Cerrar
    if (customId === "modal_submit_close") {
      const numRaw = getModalValue(components, "number").replace(/#/g, "");
      const issueNum = parseInt(numRaw, 10);
      const reason = getModalValue(components, "reason");

      if (isNaN(issueNum)) {
        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: { content: "⚠️ Por favor indica un número de issue válido." },
        });
        return;
      }

      try {
        const resolved = await findIssueByNumber(env, issueNum);
        const { issueUrl, title } = await closeGitHubIssue(
          env,
          resolved.owner,
          resolved.repo,
          resolved.number,
          reason,
          authorName
        );

        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: {
            content:
              `🔒 **Issue #${resolved.number} cerrada con éxito en GitHub!**\n\n` +
              `• **Título:** ${title}\n` +
              `${reason ? `• **Motivo:** ${reason}\n` : ""}` +
              `• **Cerrado por:** <@${user?.id}>\n\n` +
              `🔗 <${issueUrl}>`,
            components: buildControlActionRows(),
          },
        });

        await logEvent(env, {
          level: "SUCCESS",
          event: "ISSUE_CLOSED",
          user: `@${authorName}`,
          org: resolved.owner === "InledGroup" ? "InledGroup" : "Inled-Pulsar-OS",
          message: `Closed #${resolved.number} ("${title}")`,
          details: reason,
        });
      } catch (err) {
        await respondInteraction(env, interaction.id, interaction.token, {
          type: 4,
          data: { content: `❌ Error al cerrar la issue: ${sanitizeOutput(String(err))}` },
        });
      }
      return;
    }
  }
}

async function processMessage(env: Env, message: DiscordMessage): Promise<void> {
  if (message.author?.bot) return;

  let botUserId = env.BOT_USER_ID;
  if (!botUserId) {
    try {
      const gw = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("global"));
      const st = (await gw.fetch(new Request("https://internal/status")).then((r) => r.json())) as any;
      botUserId = st.botUserId || undefined;
    } catch {
      // DO no listo
    }
  }

  const intent = parseIssueCommand(message, botUserId);
  if (!intent) return;

  const authorName = message.author.global_name || message.author.username;

  // 1. COMANDO HELP
  if (intent.action === "help") {
    await sendDiscordMessage(
      env,
      message.channel_id,
      getHelpMessage(),
      message.id,
      buildControlActionRows()
    );
    return;
  }

  // 2. COMANDO CLOSE / CERRAR
  if (intent.action === "close") {
    try {
      const resolved = await findIssueByNumber(env, intent.issueNumber);
      const { issueUrl, title } = await closeGitHubIssue(
        env,
        resolved.owner,
        resolved.repo,
        resolved.number,
        intent.reason,
        authorName
      );

      const replyContent =
        `🔒 **Issue #${resolved.number} cerrada con éxito en GitHub!**\n\n` +
        `• **Título:** ${title}\n` +
        `${intent.reason ? `• **Motivo:** ${intent.reason}\n` : ""}` +
        `• **Cerrado por:** <@${message.author.id}>\n\n` +
        `🔗 <${issueUrl}>`;

      await sendDiscordMessage(env, message.channel_id, replyContent, message.id, buildControlActionRows());

      await logEvent(env, {
        level: "SUCCESS",
        event: "ISSUE_CLOSED",
        user: `@${authorName}`,
        org: resolved.owner === "InledGroup" ? "InledGroup" : "Inled-Pulsar-OS",
        message: `Closed #${resolved.number}: "${title}"`,
        details: intent.reason,
      });
    } catch (err) {
      const safeError = sanitizeOutput(String(err));
      await sendDiscordMessage(env, message.channel_id, `❌ Error al cerrar issue: ${safeError}`, message.id);
      await logEvent(env, {
        level: "ERROR",
        event: "CLOSE_FAILED",
        user: `@${authorName}`,
        org: "General",
        message: `Failed to close issue #${intent.issueNumber}: ${safeError}`,
      });
    }
    return;
  }

  // 3. COMANDO COMMENT / COMENTAR
  if (intent.action === "comment") {
    try {
      const resolved = await findIssueByNumber(env, intent.issueNumber);
      const { commentUrl } = await addIssueComment(
        env,
        resolved.owner,
        resolved.repo,
        resolved.number,
        intent.comment,
        authorName
      );

      const replyContent =
        `💬 **Comentario añadido con éxito en #${resolved.number}!**\n\n` +
        `> ${intent.comment}\n\n` +
        `🔗 <${commentUrl}>`;

      await sendDiscordMessage(env, message.channel_id, replyContent, message.id, buildControlActionRows());

      await logEvent(env, {
        level: "SUCCESS",
        event: "ISSUE_COMMENTED",
        user: `@${authorName}`,
        org: resolved.owner === "InledGroup" ? "InledGroup" : "Inled-Pulsar-OS",
        message: `Commented on #${resolved.number}: "${intent.comment.slice(0, 60)}"`,
      });
    } catch (err) {
      const safeError = sanitizeOutput(String(err));
      await sendDiscordMessage(env, message.channel_id, `❌ Error al comentar: ${safeError}`, message.id);
      await logEvent(env, {
        level: "ERROR",
        event: "COMMENT_FAILED",
        user: `@${authorName}`,
        org: "General",
        message: `Failed to comment on #${intent.issueNumber}: ${safeError}`,
      });
    }
    return;
  }

  // 4. COMANDO VIEW
  if (intent.action === "view") {
    const orgLabel = intent.org === "pulsar" ? "Inled-Pulsar-OS" : "InledGroup";
    await logEvent(env, {
      level: "INFO",
      event: "COMMAND_VIEW",
      user: `@${authorName}`,
      org: orgLabel,
      message: `User requested to view issues on ${orgLabel}`,
      details: intent.filterType ? `Filter: ${intent.filterType}` : "All open issues",
    });

    try {
      const { items, boardUrl, orgName } = await fetchProjectIssues(env, intent.org, intent.filterType);

      if (items.length === 0) {
        await sendDiscordMessage(
          env,
          message.channel_id,
          `ℹ️ No open issues found on **${orgName}** Project Board.\n\n🔗 **View Board:** ${boardUrl}`,
          message.id,
          buildControlActionRows()
        );
        return;
      }

      const filterHeader = intent.filterType ? ` [${intent.filterType}]` : "";
      const lines = items.map((it, idx) => {
        const numStr = it.number ? `[#${it.number}] ` : "";
        const icon = it.type === "Error" ? "🐛" : it.type === "Idea" ? "💡" : it.type === "Ayuda" ? "🤝" : "📌";
        const typeStr = it.type ? `*${icon} [${it.type}]* ` : "";
        return `${idx + 1}. ${typeStr}${numStr}**${it.title}**\n   🔗 <${it.url}>`;
      });

      const replyContent = `📋 **${orgName} — Issues abiertas${filterHeader} (${items.length}):**\n\n${lines.join("\n\n")}\n\n👉 **Tablero completo:** <${boardUrl}>`;

      await sendDiscordMessage(env, message.channel_id, replyContent, message.id, buildControlActionRows());

      await logEvent(env, {
        level: "SUCCESS",
        event: "ISSUES_VIEWED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Displayed ${items.length} issues to @${authorName}`,
      });
    } catch (err) {
      console.error("Error viewing issues:", err);
      const safeError = sanitizeOutput(String(err));
      await sendDiscordMessage(
        env,
        message.channel_id,
        `❌ Error querying GitHub Project Board: ${safeError}`,
        message.id,
        buildControlActionRows()
      );
      await logEvent(env, {
        level: "ERROR",
        event: "VIEW_FAILED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Failed to fetch issues: ${safeError}`,
      });
    }
    return;
  }

  // 5. COMANDO CREATE
  if (intent.action === "create") {
    const orgLabel = intent.org === "pulsar" ? "Inled-Pulsar-OS" : "InledGroup";

    if (isRateLimited(message.author.id, 3, 60)) {
      await sendDiscordMessage(
        env,
        message.channel_id,
        `⚠️ Por favor espera un momento antes de añadir más issues (máximo 3 por minuto).`,
        message.id
      );
      return;
    }

    await logEvent(env, {
      level: "INFO",
      event: "COMMAND_CREATE",
      user: `@${authorName}`,
      org: orgLabel,
      message: `Creating ${intent.type} on ${orgLabel}: "${intent.title}"`,
    });

    try {
      const result = await createProjectDraftIssue(
        env,
        intent.org,
        intent.title,
        intent.body,
        intent.type
      );

      const typeEmoji = intent.type === "Error" ? "🐛" : "💡";
      const replyContent =
        `✅ **Issue successfully added to GitHub Project Board!**\n\n` +
        `• **Organization:** ${result.orgName}\n` +
        `• **Type:** ${typeEmoji} **${intent.type}**\n` +
        `• **Title:** ${intent.title}\n` +
        `• **Reported by:** <@${message.author.id}>\n\n` +
        `👉 **View on Project Board:** <${result.boardUrl}>`;

      await sendDiscordMessage(env, message.channel_id, replyContent, message.id, buildControlActionRows());

      await logEvent(env, {
        level: "SUCCESS",
        event: "ISSUE_CREATED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Added to ${result.orgName} (ID: ${result.itemId})`,
        details: intent.title,
      });
    } catch (err) {
      console.error("Error creating project issue:", err);
      const safeError = sanitizeOutput(String(err));
      await sendDiscordMessage(
        env,
        message.channel_id,
        `❌ Error adding issue to GitHub Project Board: ${safeError}`,
        message.id,
        buildControlActionRows()
      );
      await logEvent(env, {
        level: "ERROR",
        event: "CREATE_FAILED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Failed to create issue: ${safeError}`,
      });
    }
  }
}

async function handleStatus(env: Env): Promise<Response> {
  let gateway = { connected: false, lastDispatch: null, botUsername: null, botUserId: null };
  try {
    const gw = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("global"));
    const live = (await gw.fetch(new Request("https://internal/status")).then((r) => r.json())) as any;
    gateway = live;
  } catch {
    // DO no listo
  }
  return Response.json({ gateway });
}

async function handleConnect(env: Env, url: URL): Promise<Response> {
  const stub = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("global"));
  const webhookUrl = `${url.origin}/discord/events`;
  await stub.fetch(
    new Request("https://internal/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl }),
    })
  );

  await logEvent(env, {
    level: "INFO",
    event: "GATEWAY_RECONNECTED",
    org: "General",
    message: "Discord Gateway connection initiated via dashboard",
  });

  return Response.json({ ok: true });
}
