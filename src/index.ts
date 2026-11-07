import { serveDashboardHtml } from "./dashboard";
import { parseIssueCommand, sendDiscordMessage } from "./discord";
import { DiscordGateway } from "./gateway";
import { createProjectDraftIssue, fetchProjectIssues } from "./github";
import { logEvent, LogStore } from "./logger";
import { DiscordMessage, Env } from "./types";

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

  const body = (await request.json()) as { event: string; data: any };
  if (body.event === "MESSAGE_CREATE") {
    ctx.waitUntil(processMessage(env, body.data as DiscordMessage));
  }

  return new Response("ok");
}

async function processMessage(env: Env, message: DiscordMessage): Promise<void> {
  if (message.author?.bot) return;

  // Obtener botUserId desde el gateway si no está configurado estáticamente
  let botUserId = env.BOT_USER_ID;
  if (!botUserId) {
    try {
      const gw = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("global"));
      const st = (await gw.fetch(new Request("https://internal/status")).then((r) => r.json())) as any;
      botUserId = st.botUserId || undefined;
    } catch {
      // Ignorar
    }
  }

  const intent = parseIssueCommand(message, botUserId);
  if (!intent) return; // No fue invocado IssueBot

  const authorName = message.author.global_name || message.author.username;

  // 1. COMANDO VIEW (Ver issues en el board)
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
          message.id
        );
        return;
      }

      const filterHeader = intent.filterType ? ` [${intent.filterType}]` : "";
      const displayItems = items.slice(0, 20);
      const lines = displayItems.map((it, idx) => {
        const numStr = it.number ? `[#${it.number}] ` : "";
        const icon = it.type === "Error" ? "🐛" : it.type === "Idea" ? "💡" : it.type === "Ayuda" ? "🤝" : "📌";
        const typeStr = it.type ? `*${icon} [${it.type}]* ` : "";
        return `${idx + 1}. ${typeStr}${numStr}**${it.title}**\n   🔗 <${it.url}>`;
      });

      const countNotice = items.length > 20 ? `\n\n*(Mostrando 20 de ${items.length} issues abiertas)*` : "";
      const replyContent = `📋 **${orgName} — Issues abiertas${filterHeader} (${items.length}):**\n\n${lines.join("\n\n")}${countNotice}\n\n👉 **Tablero completo:** <${boardUrl}>`;

      await sendDiscordMessage(env, message.channel_id, replyContent, message.id);

      await logEvent(env, {
        level: "SUCCESS",
        event: "ISSUES_VIEWED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Displayed ${items.length} issues to @${authorName}`,
      });
    } catch (err) {
      console.error("Error viewing issues:", err);
      await sendDiscordMessage(
        env,
        message.channel_id,
        `❌ Error querying GitHub Project Board: ${String(err)}`,
        message.id
      );
      await logEvent(env, {
        level: "ERROR",
        event: "VIEW_FAILED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Failed to fetch issues: ${String(err)}`,
      });
    }
    return;
  }

  // 2. COMANDO CREATE (Crear issue en el board)
  if (intent.action === "create") {
    const orgLabel = intent.org === "pulsar" ? "Inled-Pulsar-OS" : "InledGroup";
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

      await sendDiscordMessage(env, message.channel_id, replyContent, message.id);

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
      await sendDiscordMessage(
        env,
        message.channel_id,
        `❌ Error adding issue to GitHub Project Board: ${String(err)}`,
        message.id
      );
      await logEvent(env, {
        level: "ERROR",
        event: "CREATE_FAILED",
        user: `@${authorName}`,
        org: orgLabel,
        message: `Failed to create issue: ${String(err)}`,
      });
    }
    return;
  }

  // 3. COMANDO HELP / GUÍA
  if (intent.action === "help") {
    const helpText =
      `🤖 **IssueBot — GitHub Project Board Assistant**\n\n` +
      `**1. Add an issue to a Project Board:**\n` +
      `Include **error** (or *bug*) or **suggestion** (or *idea*), and **pulsar** or **inled**:\n` +
      `• \`@IssueBot error pulsar Spotlight icon does not show in dock\`\n` +
      `• \`@IssueBot suggestion pulsar Add dark mode toggle in control center\`\n` +
      `• \`@IssueBot error inled Login button unresponsive in customer portal\`\n` +
      `• \`@IssueBot suggestion inled Improve CLI installer output\`\n\n` +
      `**2. View open issues from a Board:**\n` +
      `• \`@IssueBot view pulsar\` *(or \`@IssueBot view pulsar error\`)*\n` +
      `• \`@IssueBot view inled\`\n\n` +
      `🔗 **Pulsar OS Board:** <https://github.com/orgs/Inled-Pulsar-OS/projects/1/views/2>\n` +
      `🔗 **InledGroup Board:** <https://github.com/orgs/InledGroup/projects/1/views/1>`;

    await sendDiscordMessage(env, message.channel_id, helpText, message.id);
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
