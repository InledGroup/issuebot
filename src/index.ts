import { serveDashboardHtml } from "./dashboard";
import {
  buildControlActionRows,
  editOriginalInteractionResponse,
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

    // Public activity log dashboard
    if (path === "/" || path === "/logs" || path === "/index.html") {
      return serveDashboardHtml();
    }

    // Logs API
    if (path === "/api/logs") {
      const store = env.LOG_STORE.get(env.LOG_STORE.idFromName("global"));
      if (request.method === "GET") {
        return await store.fetch(new Request("https://internal/logs"));
      }
      if (request.method === "DELETE") {
        return await store.fetch(new Request("https://internal/clear", { method: "DELETE" }));
      }
    }

    // Status API
    if (path === "/api/status") {
      return await handleStatus(env);
    }

    // Gateway Reconnect API
    if (path === "/api/connect" && request.method === "POST") {
      return await handleConnect(env, url);
    }

    // Internal Gateway Events
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
    `🤖 **IssueBot — GitHub Project Board Assistant**\n\n` +
    `**✨ Interactive Dashboard:**\n` +
    `Click any button below to filter issues or open modal dialogs:\n` +
    `• **➕ New Issue**: Opens a popup form to submit a bug report or suggestion.\n` +
    `• **💬 Comment**: Add a progress update or comment to any issue.\n` +
    `• **🔒 Close Issue**: Mark an issue as closed and resolved on GitHub.\n` +
    `• **🚀 Pulsar (All) / 🏢 InledGroup**: Filter issues by organization.\n\n` +
    `**⚡ Quick Text Commands:**\n` +
    `• \`!issue help\` or \`@IssueBot help\` ➔ Display this guide and interactive controls.\n` +
    `• \`@IssueBot view pulsar\` ➔ Show all open issues on Pulsar OS Project Board.\n` +
    `• \`@IssueBot view pulsar errors\` ➔ Show open errors only.\n` +
    `• \`@IssueBot view pulsar ideas\` ➔ Show ideas and feature proposals.\n` +
    `• \`@IssueBot view inled\` ➔ Show open issues on InledGroup Board.\n` +
    `• \`@IssueBot pulsar error <description>\` ➔ Create an error on Pulsar OS Board.\n` +
    `• \`@IssueBot pulsar idea <description>\` ➔ Submit a proposal to Pulsar OS Board.\n` +
    `• \`@IssueBot inled error <description>\` ➔ Create an error on InledGroup Board.\n` +
    `• \`@IssueBot comment #223 <message>\` ➔ Post a comment directly on issue #223.\n` +
    `• \`@IssueBot close #223 [optional reason]\` ➔ Close issue #223 on GitHub.\n\n` +
    `🔗 **Pulsar OS Project Board:** <https://github.com/orgs/Inled-Pulsar-OS/projects/1/views/2>\n` +
    `🔗 **InledGroup Project Board:** <https://github.com/orgs/InledGroup/projects/1/views/1>`
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

  // 1. BUTTON CLICKS (Component Type 3)
  if (interaction.type === 3) {
    // Open Modals: must respond immediately with type: 9 (MODAL) within 3 seconds
    if (customId === "action:open_create_modal") {
      await respondInteraction(interaction.id, interaction.token, getCreateIssueModal());
      return;
    }

    if (customId === "action:open_comment_modal") {
      await respondInteraction(interaction.id, interaction.token, getCommentModal());
      return;
    }

    if (customId === "action:open_close_modal") {
      await respondInteraction(interaction.id, interaction.token, getCloseModal());
      return;
    }

    if (customId === "action:show_help") {
      await respondInteraction(interaction.id, interaction.token, {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: getHelpMessage(),
          components: buildControlActionRows(),
        },
      });
      return;
    }

    // Filter Buttons: Defer update immediately (type: 6) so Discord doesn't time out, then edit message
    if (customId.startsWith("filter:")) {
      // Step 1: Acknowledge interaction immediately (< 50ms)
      await respondInteraction(interaction.id, interaction.token, {
        type: 6, // DEFERRED_UPDATE_MESSAGE
      });

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
            ? `ℹ️ No open issues found on **${orgName}**${filterHeader}.\n\n👉 **Full Project Board:** <${boardUrl}>`
            : `📋 **${orgName} — Open Issues${filterHeader} (${items.length}):**\n\n${lines.join("\n\n")}\n\n👉 **Full Project Board:** <${boardUrl}>`;

        // Step 2: Update original message with the fetched issues and buttons
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: replyContent,
          components: buildControlActionRows(),
        });
      } catch (err) {
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: `❌ Error querying issues: ${sanitizeOutput(String(err))}`,
          components: buildControlActionRows(),
        });
      }
      return;
    }
  }

  // 2. MODAL FORM SUBMISSIONS (Type 5)
  if (interaction.type === 5) {
    const components = interaction.data?.components;

    // Acknowledge modal submission immediately with deferred source (type: 5)
    await respondInteraction(interaction.id, interaction.token, {
      type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    });

    // Create Issue Modal
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
          `✅ **Issue successfully created on GitHub Project Board!**\n\n` +
          `• **Organization:** ${res.orgName}\n` +
          `• **Type:** ${typeEmoji} **${type}**\n` +
          `• **Title:** ${title}\n` +
          `• **Reported by:** <@${user?.id}>\n\n` +
          `👉 **View on Project Board:** <${res.boardUrl}>`;

        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: replyText,
          components: buildControlActionRows(),
        });

        await logEvent(env, {
          level: "SUCCESS",
          event: "MODAL_ISSUE_CREATED",
          user: `@${authorName}`,
          org: res.orgName as any,
          message: `Created ${type} via Modal: "${title}"`,
        });
      } catch (err) {
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: `❌ Error creating issue: ${sanitizeOutput(String(err))}`,
          components: buildControlActionRows(),
        });
      }
      return;
    }

    // Comment Modal
    if (customId === "modal_submit_comment") {
      const numRaw = getModalValue(components, "number").replace(/#/g, "");
      const issueNum = parseInt(numRaw, 10);
      const commentText = getModalValue(components, "comment");

      if (isNaN(issueNum) || !commentText) {
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: "⚠️ Please provide a valid issue number and comment.",
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

        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `💬 **Comment successfully added to #${resolved.number}!**\n\n` +
            `> ${commentText.slice(0, 200)}\n\n` +
            `🔗 <${commentUrl}>`,
          components: buildControlActionRows(),
        });

        await logEvent(env, {
          level: "SUCCESS",
          event: "ISSUE_COMMENTED",
          user: `@${authorName}`,
          org: resolved.owner === "InledGroup" ? "InledGroup" : "Inled-Pulsar-OS",
          message: `Commented on #${resolved.number}: "${commentText.slice(0, 60)}"`,
        });
      } catch (err) {
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: `❌ Error adding comment: ${sanitizeOutput(String(err))}`,
          components: buildControlActionRows(),
        });
      }
      return;
    }

    // Close Modal
    if (customId === "modal_submit_close") {
      const numRaw = getModalValue(components, "number").replace(/#/g, "");
      const issueNum = parseInt(numRaw, 10);
      const reason = getModalValue(components, "reason");

      if (isNaN(issueNum)) {
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: "⚠️ Please provide a valid issue number.",
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

        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `🔒 **Issue #${resolved.number} successfully closed on GitHub!**\n\n` +
            `• **Title:** ${title}\n` +
            `${reason ? `• **Reason:** ${reason}\n` : ""}` +
            `• **Closed by:** <@${user?.id}>\n\n` +
            `🔗 <${issueUrl}>`,
          components: buildControlActionRows(),
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
        await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
          content: `❌ Error closing issue: ${sanitizeOutput(String(err))}`,
          components: buildControlActionRows(),
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
      // DO not ready
    }
  }

  const intent = parseIssueCommand(message, botUserId);
  if (!intent) return;

  const authorName = message.author.global_name || message.author.username;

  // 1. HELP COMMAND
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

  // 2. CLOSE COMMAND
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
        `🔒 **Issue #${resolved.number} successfully closed on GitHub!**\n\n` +
        `• **Title:** ${title}\n` +
        `${intent.reason ? `• **Reason:** ${intent.reason}\n` : ""}` +
        `• **Closed by:** <@${message.author.id}>\n\n` +
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
      await sendDiscordMessage(env, message.channel_id, `❌ Error closing issue: ${safeError}`, message.id);
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

  // 3. COMMENT COMMAND
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
        `💬 **Comment successfully added to #${resolved.number}!**\n\n` +
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
      await sendDiscordMessage(env, message.channel_id, `❌ Error adding comment: ${safeError}`, message.id);
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

  // 4. VIEW COMMAND
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

      const replyContent = `📋 **${orgName} — Open Issues${filterHeader} (${items.length}):**\n\n${lines.join("\n\n")}\n\n👉 **Full Project Board:** <${boardUrl}>`;

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

  // 5. CREATE COMMAND
  if (intent.action === "create") {
    const orgLabel = intent.org === "pulsar" ? "Inled-Pulsar-OS" : "InledGroup";

    if (isRateLimited(message.author.id, 3, 60)) {
      await sendDiscordMessage(
        env,
        message.channel_id,
        `⚠️ Please wait a moment before creating more issues (maximum 3 per minute).`,
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
    // DO not ready
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
