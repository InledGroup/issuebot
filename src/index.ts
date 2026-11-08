import { serveDashboardHtml } from "./dashboard";
import {
  buildControlActionRows,
  editOriginalInteractionResponse,
  getCloseModal,
  getCommentModal,
  getCreateIssueModal,
  registerSlashCommands,
  sendDiscordMessage,
} from "./discord";
import {
  addIssueComment,
  closeGitHubIssue,
  createProjectIssue,
  fetchProjectIssues,
  findIssueByNumber,
} from "./github";
import { clearRecentLogs, getRecentLogs, logEvent } from "./logger";
import {
  getDiscordPublicKey,
  isRateLimited,
  sanitizeOutput,
  verifyDiscordRequest,
} from "./security";
import { DiscordInteraction, Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. DISCORD INTERACTIONS WEBHOOK ENDPOINT
    // Handles requests at root '/', '/discord/interactions', '/api/interactions'
    // or any request containing Discord's Ed25519 signature headers.
    const isInteraction =
      request.method === "POST" &&
      (path === "/" ||
        path === "/discord/interactions" ||
        path === "/api/interactions" ||
        request.headers.has("x-signature-ed25519"));

    if (isInteraction) {
      return await handleDiscordInteraction(request, env, ctx);
    }

    // 2. DASHBOARD HTML
    if (path === "/" || path === "/logs" || path === "/index.html") {
      return serveDashboardHtml();
    }

    // 3. API STATUS
    if (path === "/api/status") {
      const logs = getRecentLogs();
      return Response.json({
        ok: true,
        mode: "Discord Interactions Webhook (0 Durable Objects - 100% Free)",
        durableObjectsCount: 0,
        botUsername: "IssueBot",
        totalLogs: logs.length,
      });
    }

    // 4. API LOGS
    if (path === "/api/logs") {
      if (request.method === "GET") {
        return Response.json(getRecentLogs());
      }
      if (request.method === "DELETE") {
        clearRecentLogs();
        return Response.json({ ok: true });
      }
    }

    // 5. REGISTER SLASH COMMANDS API
    if (path === "/api/register-commands" && request.method === "POST") {
      try {
        const result = await registerSlashCommands(env);
        return Response.json(result);
      } catch (err) {
        return Response.json({ ok: false, error: sanitizeOutput(String(err)) }, { status: 500 });
      }
    }

    // 6. POST PANEL TO DISCORD CHANNEL API
    if (path === "/api/post-panel" && request.method === "POST") {
      try {
        const body = (await request.json()) as { channel_id?: string };
        if (!body.channel_id) {
          return Response.json({ ok: false, error: "Missing channel_id" }, { status: 400 });
        }
        await sendDiscordMessage(
          env,
          body.channel_id,
          getHelpMessage(),
          undefined,
          buildControlActionRows()
        );
        return Response.json({ ok: true, message: `Panel posted to channel ${body.channel_id}` });
      } catch (err) {
        return Response.json({ ok: false, error: sanitizeOutput(String(err)) }, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

function getHelpMessage(): string {
  return (
    `🤖 **IssueBot — GitHub Project Board Assistant**\n\n` +
    `**✨ Interactive Dashboard:**\n` +
    `Click any button below to filter issues or open modal dialogs:\n` +
    `• **➕ New Issue**: Opens a popup form to submit a bug report or suggestion.\n` +
    `• **💬 Comment**: Add a progress update or comment to any issue.\n` +
    `• **🔒 Close Issue**: Mark an issue as closed and resolved on GitHub.\n` +
    `• **🚀 Pulsar (All) / 🏢 InledGroup**: Filter issues by organization.\n\n` +
    `**⚡ Slash Commands:**\n` +
    `• \`/issue help\` ➔ Display this guide and interactive controls.\n` +
    `• \`/issue view [org] [type]\` ➔ View open issues on project boards.\n` +
    `• \`/issue create <title> <org> <type> [details]\` ➔ Create a new issue.\n` +
    `• \`/issue comment <number> <message>\` ➔ Post a comment directly on an issue.\n` +
    `• \`/issue close <number> [reason]\` ➔ Close an issue on GitHub.\n` +
    `• \`/panel\` ➔ Post the interactive button panel in the current channel.\n\n` +
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
 * Handles incoming Discord Interactions sent via Discord HTTP Webhooks
 */
async function handleDiscordInteraction(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const rawBody = await request.text();

  // 1. Cryptographic Ed25519 Signature Verification
  let publicKey = "";
  try {
    publicKey = await getDiscordPublicKey(env);
  } catch (err) {
    console.error("Failed to obtain Discord public key:", err);
    return new Response("Configuration error: Missing public key", { status: 500 });
  }

  const isValid = await verifyDiscordRequest(request, publicKey, rawBody);
  if (!isValid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  // 2. Interaction Type 1: PING (Required for Discord webhook verification)
  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  const user = interaction.user || interaction.member?.user;
  const authorName = user?.global_name || user?.username || "DiscordUser";
  const customId = interaction.data?.custom_id || "";

  // 3. Interaction Type 2: APPLICATION_COMMAND (Slash Commands)
  if (interaction.type === 2) {
    const cmdName = interaction.data?.name;

    if (cmdName === "help" || cmdName === "panel") {
      return Response.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: getHelpMessage(),
          components: buildControlActionRows(),
        },
      });
    }

    if (cmdName === "issue") {
      const subOption = interaction.data?.options?.[0];
      const subName = subOption?.name || "help";

      if (subName === "help") {
        return Response.json({
          type: 4,
          data: {
            content: getHelpMessage(),
            components: buildControlActionRows(),
          },
        });
      }

      // For long-running operations, defer message source immediately (< 50ms)
      ctx.waitUntil(handleSlashCommand(env, interaction, subName, subOption?.options || []));
      return Response.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }
  }

  // 4. Interaction Type 3: MESSAGE_COMPONENT (Buttons)
  if (interaction.type === 3) {
    // Modal Openers must return type: 9 synchronously in the HTTP response
    if (customId === "action:open_create_modal") {
      return Response.json(getCreateIssueModal());
    }
    if (customId === "action:open_comment_modal") {
      return Response.json(getCommentModal());
    }
    if (customId === "action:open_close_modal") {
      return Response.json(getCloseModal());
    }
    if (customId === "action:show_help") {
      return Response.json({
        type: 4,
        data: {
          content: getHelpMessage(),
          components: buildControlActionRows(),
        },
      });
    }

    // Filter Buttons: Defer update immediately (type: 6) and process in background
    if (customId.startsWith("filter:")) {
      ctx.waitUntil(handleFilterButton(env, interaction, customId));
      return Response.json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
    }
  }

  // 5. Interaction Type 5: MODAL_SUBMIT
  if (interaction.type === 5) {
    ctx.waitUntil(handleModalSubmit(env, interaction, authorName));
    return Response.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  }

  return Response.json({ type: 4, data: { content: "Unrecognized interaction" } });
}

async function handleFilterButton(
  env: Env,
  interaction: DiscordInteraction,
  customId: string
): Promise<void> {
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
}

async function handleModalSubmit(
  env: Env,
  interaction: DiscordInteraction,
  authorName: string
): Promise<void> {
  const customId = interaction.data?.custom_id || "";
  const components = interaction.data?.components;
  const user = interaction.user || interaction.member?.user;

  // Anti-spam check
  if (user && isRateLimited(user.id, 3, 60)) {
    await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
      content: "⚠️ **Rate limit exceeded:** You can submit up to 3 issues per minute. Please try again shortly.",
    });
    return;
  }

  // Create Issue
  if (customId === "modal_submit_create") {
    const orgInput = getModalValue(components, "org").toLowerCase();
    const org: "pulsar" | "inled" = orgInput.includes("inled") ? "inled" : "pulsar";
    const typeInput = getModalValue(components, "type").toLowerCase();
    const type: "Error" | "Idea" =
      typeInput.includes("idea") || typeInput.includes("suggestion") ? "Idea" : "Error";
    const title = getModalValue(components, "title") || "Untitled issue";
    const details = getModalValue(components, "details");
    const body = `Reported via Discord Modal by @${authorName}\n\n${details || title}`;

    try {
      const res = await createProjectIssue(env, org, title, body, type);
      const typeEmoji = type === "Error" ? "🐛" : "💡";
      const replyText =
        `✅ **Issue #${res.issueNumber} successfully created on GitHub!**\n\n` +
        `• **Title:** ${res.title}\n` +
        `• **Organization:** ${res.orgName}\n` +
        `• **Type:** ${typeEmoji} **${type}**\n` +
        `• **Reported by:** <@${user?.id}>\n\n` +
        `🔗 **GitHub Issue:** <${res.issueUrl}>\n` +
        `👉 **Project Board:** <${res.boardUrl}>`;

      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content: replyText,
        components: buildControlActionRows(),
      });

      await logEvent(env, {
        level: "SUCCESS",
        event: "MODAL_ISSUE_CREATED",
        user: `@${authorName}`,
        org: res.orgName as any,
        message: `Created ${type} #${res.issueNumber}: "${title}"`,
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

async function handleSlashCommand(
  env: Env,
  interaction: DiscordInteraction,
  subcommand: string,
  options: Array<{ name: string; value?: any }>
): Promise<void> {
  const getOpt = (name: string) => options.find((o) => o.name === name)?.value;
  const user = interaction.user || interaction.member?.user;
  const authorName = user?.global_name || user?.username || "DiscordUser";

  try {
    if (subcommand === "view") {
      const org = (getOpt("org") || "pulsar") as "pulsar" | "inled";
      const rawType = getOpt("type");
      const filterType = rawType === "all" ? undefined : rawType;

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

      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content: replyContent,
        components: buildControlActionRows(),
      });
      return;
    }

    if (subcommand === "create") {
      const title = String(getOpt("title") || "").trim();
      const org = (getOpt("org") || "pulsar") as "pulsar" | "inled";
      const type = (getOpt("type") === "idea" ? "Idea" : "Error") as "Error" | "Idea";
      const details = getOpt("details");
      const body = `Reported via Discord Slash Command by @${authorName}\n\n${details || title}`;

      const res = await createProjectIssue(env, org, title, body, type);
      const typeEmoji = type === "Error" ? "🐛" : "💡";
      const replyText =
        `✅ **Issue #${res.issueNumber} successfully created on GitHub!**\n\n` +
        `• **Title:** ${res.title}\n` +
        `• **Organization:** ${res.orgName}\n` +
        `• **Type:** ${typeEmoji} **${type}**\n` +
        `• **Reported by:** <@${user?.id}>\n\n` +
        `🔗 **GitHub Issue:** <${res.issueUrl}>\n` +
        `👉 **View on Project Board:** <${res.boardUrl}>`;

      await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
        content: replyText,
        components: buildControlActionRows(),
      });

      await logEvent(env, {
        level: "SUCCESS",
        event: "COMMAND_ISSUE_CREATED",
        user: `@${authorName}`,
        org: res.orgName as any,
        message: `Created ${type} #${res.issueNumber}: "${title}"`,
      });
      return;
    }

    if (subcommand === "comment") {
      const issueNum = parseInt(String(getOpt("number")), 10);
      const commentText = String(getOpt("message") || "").trim();

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
        message: `Commented on #${resolved.number}`,
      });
      return;
    }

    if (subcommand === "close") {
      const issueNum = parseInt(String(getOpt("number")), 10);
      const reason = getOpt("reason") ? String(getOpt("reason")) : undefined;

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
        message: `Closed #${resolved.number}: "${title}"`,
        details: reason,
      });
      return;
    }
  } catch (err) {
    await editOriginalInteractionResponse(interaction.application_id, interaction.token, {
      content: `❌ Error processing command: ${sanitizeOutput(String(err))}`,
      components: buildControlActionRows(),
    });
  }
}
