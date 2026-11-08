import { DiscordMessage, Env } from "./types";

const DISCORD_API = "https://discord.com/api/v10";

export function splitDiscordMessage(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      if (current.trim().length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      if (line.length > maxLen) {
        let remaining = line;
        while (remaining.length > maxLen) {
          chunks.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        current = remaining;
      } else {
        current = line;
      }
    } else {
      current = current.length > 0 ? `${current}\n${line}` : line;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

export async function sendDiscordMessage(
  env: Env,
  channelId: string,
  content: string,
  replyToMessageId?: string,
  components?: any[]
): Promise<Response> {
  const chunks = splitDiscordMessage(content, 1900);
  let lastRes: Response | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const payload: Record<string, unknown> = {
      content: chunk,
      allowed_mentions: { replied_user: i === 0 },
    };

    if (i === 0 && replyToMessageId) {
      payload.message_reference = {
        message_id: replyToMessageId,
      };
    }

    if (isLast && components && components.length > 0) {
      payload.components = components;
    }

    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Discord message send failed: ${res.status} ${errText}`);
    }

    lastRes = res;
  }

  return lastRes!;
}

/**
 * Responds to a Discord interaction callback.
 * Note: Discord interaction callback endpoints do NOT require Authorization header.
 */
export async function respondInteraction(
  interactionId: string,
  interactionToken: string,
  body: Record<string, unknown>
): Promise<Response> {
  const res = await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Interaction callback error: ${res.status} ${errText}`);
  }

  return res;
}

/**
 * Edits the original deferred interaction response via webhook
 */
export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  body: Record<string, unknown>
): Promise<Response> {
  const res = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Edit original interaction failed: ${res.status} ${errText}`);
  }

  return res;
}

/**
 * Builds standard interactive control buttons for Discord (all in English)
 */
export function buildControlActionRows() {
  return [
    {
      type: 1, // ActionRow
      components: [
        { type: 2, style: 1, label: "🚀 Pulsar (All)", custom_id: "filter:pulsar:all" },
        { type: 2, style: 2, label: "🐛 Errors", custom_id: "filter:pulsar:Error" },
        { type: 2, style: 2, label: "💡 Ideas", custom_id: "filter:pulsar:Idea" },
        { type: 2, style: 2, label: "🤝 Help Tasks", custom_id: "filter:pulsar:Ayuda" },
        { type: 2, style: 1, label: "🏢 InledGroup", custom_id: "filter:inled:all" },
      ],
    },
    {
      type: 1, // ActionRow
      components: [
        { type: 2, style: 3, label: "➕ New Issue", custom_id: "action:open_create_modal" },
        { type: 2, style: 1, label: "💬 Comment", custom_id: "action:open_comment_modal" },
        { type: 2, style: 4, label: "🔒 Close Issue", custom_id: "action:open_close_modal" },
        { type: 2, style: 2, label: "❓ Help & Guide", custom_id: "action:show_help" },
      ],
    },
  ];
}

/**
 * Modal Dialog: Create New Issue (all in English)
 */
export function getCreateIssueModal() {
  return {
    type: 9, // MODAL
    data: {
      title: "Create New Issue on GitHub",
      custom_id: "modal_submit_create",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4, // TextInput
              custom_id: "org",
              label: "Organization (pulsar or inled)",
              style: 1, // Short
              value: "pulsar",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "type",
              label: "Issue Type (error or idea)",
              style: 1,
              value: "error",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "title",
              label: "Issue Title",
              style: 1,
              placeholder: "e.g. Calamares installer fails on btrfs partition",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "details",
              label: "Description / Steps to Reproduce",
              style: 2, // Paragraph
              placeholder: "Describe the error or suggestion in detail...",
              required: false,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Modal Dialog: Comment on an Issue (all in English)
 */
export function getCommentModal() {
  return {
    type: 9,
    data: {
      title: "Add Comment to GitHub Issue",
      custom_id: "modal_submit_comment",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "number",
              label: "Issue Number (#)",
              style: 1,
              placeholder: "e.g. 223",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "comment",
              label: "Your Comment",
              style: 2,
              placeholder: "Write your comment, feedback, or update...",
              required: true,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Modal Dialog: Close an Issue (all in English)
 */
export function getCloseModal() {
  return {
    type: 9,
    data: {
      title: "Close GitHub Issue",
      custom_id: "modal_submit_close",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "number",
              label: "Issue Number (#)",
              style: 1,
              placeholder: "e.g. 223",
              required: true,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "reason",
              label: "Reason for Closing (optional)",
              style: 1,
              placeholder: "e.g. Resolved in Pear OS 1.0.4 build",
              required: false,
            },
          ],
        },
      ],
    },
  };
}

export type CommandIntent =
  | {
      action: "view";
      org: "pulsar" | "inled";
      filterType?: string;
    }
  | {
      action: "create";
      org: "pulsar" | "inled";
      type: "Error" | "Idea";
      title: string;
      body: string;
    }
  | {
      action: "comment";
      issueNumber: number;
      comment: string;
    }
  | {
      action: "close";
      issueNumber: number;
      reason?: string;
    }
  | {
      action: "help";
    };

/**
 * Parses an incoming Discord message to determine if IssueBot was invoked and what command to run
 */
export function parseIssueCommand(
  message: DiscordMessage,
  botUserId?: string
): CommandIntent | null {
  const raw = message.content || "";
  const mentions = message.mentions || [];

  const isMentioned = botUserId
    ? mentions.some((u) => u.id === botUserId) || raw.includes(`<@${botUserId}>`) || raw.includes(`<@!${botUserId}>`)
    : mentions.length > 0 || raw.toLowerCase().startsWith("!issue") || raw.toLowerCase().startsWith("/issue");

  if (!isMentioned && !raw.toLowerCase().includes("issuebot")) {
    return null;
  }

  // Strip Discord mentions
  let text = raw.replace(/<@!?[0-9]+>/g, "").replace(/^!issue\s*/i, "").trim();
  const lower = text.toLowerCase();

  // 1. HELP command
  if (!text || lower === "help" || lower === "ayuda" || lower.includes("guide") || lower.includes("tutorial")) {
    return { action: "help" };
  }

  // 2. CLOSE command (e.g. close 223 [reason] or cerrar #223 [reason])
  const closeMatch = text.match(/\b(?:close|cerrar)\s+#?(\d+)(?:\s+([\s\S]+))?/i);
  if (closeMatch) {
    return {
      action: "close",
      issueNumber: parseInt(closeMatch[1], 10),
      reason: closeMatch[2]?.trim(),
    };
  }

  // 3. COMMENT command (e.g. comment 223 text or comentar 223 text)
  const commentMatch = text.match(/\b(?:comment|comentar)\s+#?(\d+)\s+([\s\S]+)/i);
  if (commentMatch) {
    return {
      action: "comment",
      issueNumber: parseInt(commentMatch[1], 10),
      comment: commentMatch[2].trim(),
    };
  }

  // 4. VIEW command
  if (lower.includes("view") || lower.includes("ver") || lower.includes("list")) {
    const org: "pulsar" | "inled" = lower.includes("inled") && !lower.includes("pulsar") ? "inled" : "pulsar";

    let filterType: string | undefined = undefined;
    if (lower.includes("error") || lower.includes("bug")) {
      filterType = "Error";
    } else if (lower.includes("suggestion") || lower.includes("idea") || lower.includes("sugerencia")) {
      filterType = "Idea";
    } else if (lower.includes("ayuda") || lower.includes("help") || lower.includes("task")) {
      filterType = "Ayuda";
    }

    return {
      action: "view",
      org,
      filterType,
    };
  }

  // 5. CREATE command
  const isError = lower.includes("error") || lower.includes("bug");
  const isSuggestion = lower.includes("suggestion") || lower.includes("idea") || lower.includes("sugerencia");

  if (isError || isSuggestion) {
    const type: "Error" | "Idea" = isError ? "Error" : "Idea";
    const org: "pulsar" | "inled" = lower.includes("inled") && !lower.includes("pulsar") ? "inled" : "pulsar";

    let cleanText = text
      .replace(/\b(error|bug|suggestion|idea|sugerencia)\b/gi, "")
      .replace(/\b(pulsar|inled)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText || cleanText.length < 3) {
      cleanText = text;
    }

    const title = cleanText.length > 90 ? cleanText.slice(0, 87) + "..." : cleanText;
    const authorName = message.author.global_name || message.author.username;
    const body = `Reported via Discord by @${authorName}\n\n${text}`;

    return {
      action: "create",
      org,
      type,
      title,
      body,
    };
  }

  return { action: "help" };
}

/**
 * Registers Slash Commands with Discord REST API globally
 */
export async function registerSlashCommands(env: Env): Promise<{ ok: boolean; count: number; commands: string[] }> {
  // 1. Get Application ID
  const meRes = await fetch(`${DISCORD_API}/oauth2/applications/@me`, {
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
  });

  if (!meRes.ok) {
    const err = await meRes.text();
    throw new Error(`Failed to get Discord application ID: ${meRes.status} ${err}`);
  }

  const meData = (await meRes.json()) as { id: string };
  const appId = meData.id;

  const commandsPayload = [
    {
      name: "issue",
      description: "GitHub Project Board Issue Manager",
      options: [
        {
          name: "help",
          description: "Display interactive issue board buttons and guide",
          type: 1, // SUB_COMMAND
        },
        {
          name: "view",
          description: "View open issues on GitHub Project Boards",
          type: 1,
          options: [
            {
              name: "org",
              description: "Organization board to view",
              type: 3, // STRING
              required: false,
              choices: [
                { name: "Inled-Pulsar-OS", value: "pulsar" },
                { name: "InledGroup", value: "inled" },
              ],
            },
            {
              name: "type",
              description: "Filter by issue type",
              type: 3,
              required: false,
              choices: [
                { name: "All Types", value: "all" },
                { name: "Errors Only", value: "Error" },
                { name: "Ideas / Suggestions", value: "Idea" },
                { name: "Help Tasks", value: "Ayuda" },
              ],
            },
          ],
        },
        {
          name: "create",
          description: "Create a new issue on GitHub Project Board",
          type: 1,
          options: [
            {
              name: "title",
              description: "Title of the issue or feature request",
              type: 3,
              required: true,
            },
            {
              name: "org",
              description: "Organization board",
              type: 3,
              required: true,
              choices: [
                { name: "Inled-Pulsar-OS", value: "pulsar" },
                { name: "InledGroup", value: "inled" },
              ],
            },
            {
              name: "type",
              description: "Type of issue",
              type: 3,
              required: true,
              choices: [
                { name: "Error / Bug", value: "error" },
                { name: "Idea / Proposal", value: "idea" },
              ],
            },
            {
              name: "details",
              description: "Detailed description or reproduction steps",
              type: 3,
              required: false,
            },
          ],
        },
        {
          name: "comment",
          description: "Post a comment to an existing GitHub issue",
          type: 1,
          options: [
            {
              name: "number",
              description: "GitHub Issue number (e.g. 223)",
              type: 4, // INTEGER
              required: true,
            },
            {
              name: "message",
              description: "Comment text to post on the issue",
              type: 3,
              required: true,
            },
            {
              name: "org",
              description: "Organization board (default: pulsar)",
              type: 3,
              required: false,
              choices: [
                { name: "Inled-Pulsar-OS", value: "pulsar" },
                { name: "InledGroup", value: "inled" },
              ],
            },
          ],
        },
        {
          name: "close",
          description: "Close an issue on GitHub Project Board",
          type: 1,
          options: [
            {
              name: "number",
              description: "GitHub Issue number to close (e.g. 223)",
              type: 4,
              required: true,
            },
            {
              name: "reason",
              description: "Optional closing note or resolution reason",
              type: 3,
              required: false,
            },
            {
              name: "org",
              description: "Organization board (default: pulsar)",
              type: 3,
              required: false,
              choices: [
                { name: "Inled-Pulsar-OS", value: "pulsar" },
                { name: "InledGroup", value: "inled" },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "help",
      description: "Show IssueBot interactive dashboard and action buttons",
    },
    {
      name: "panel",
      description: "Post the interactive IssueBot control panel in this channel",
    },
  ];

  const putRes = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandsPayload),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`Failed to register slash commands: ${putRes.status} ${err}`);
  }

  const created = (await putRes.json()) as Array<{ name: string }>;
  return {
    ok: true,
    count: created.length,
    commands: created.map((c) => `/${c.name}`),
  };
}
