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

export async function respondInteraction(
  env: Env,
  interactionId: string,
  interactionToken: string,
  body: Record<string, unknown>
): Promise<Response> {
  const res = await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Interaction response failed: ${res.status} ${errText}`);
  }

  return res;
}

/**
 * Builds standard interactive control buttons for Discord
 */
export function buildControlActionRows() {
  return [
    {
      type: 1, // ActionRow
      components: [
        { type: 2, style: 1, label: "🚀 Pulsar (Todo)", custom_id: "filter:pulsar:all" },
        { type: 2, style: 2, label: "🐛 Errores", custom_id: "filter:pulsar:Error" },
        { type: 2, style: 2, label: "💡 Ideas", custom_id: "filter:pulsar:Idea" },
        { type: 2, style: 2, label: "🤝 Ayuda", custom_id: "filter:pulsar:Ayuda" },
        { type: 2, style: 1, label: "🏢 InledGroup", custom_id: "filter:inled:all" },
      ],
    },
    {
      type: 1, // ActionRow
      components: [
        { type: 2, style: 3, label: "➕ Nueva Issue", custom_id: "action:open_create_modal" },
        { type: 2, style: 1, label: "💬 Comentar", custom_id: "action:open_comment_modal" },
        { type: 2, style: 4, label: "🔒 Cerrar Issue", custom_id: "action:open_close_modal" },
        { type: 2, style: 2, label: "❓ Guía y Ayuda", custom_id: "action:show_help" },
      ],
    },
  ];
}

/**
 * Modal Dialog: Crear Nueva Issue
 */
export function getCreateIssueModal() {
  return {
    type: 9, // MODAL
    data: {
      title: "Crear Nueva Issue en GitHub",
      custom_id: "modal_submit_create",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4, // TextInput
              custom_id: "org",
              label: "Organización (pulsar o inled)",
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
              label: "Tipo (error o idea)",
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
              label: "Título de la issue",
              style: 1,
              placeholder: "Ej: El instalador no monta la partición EFI",
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
              label: "Descripción / Detalles",
              style: 2, // Paragraph
              placeholder: "Describe el problema o sugerencia en detalle...",
              required: false,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Modal Dialog: Comentar en una Issue
 */
export function getCommentModal() {
  return {
    type: 9,
    data: {
      title: "Añadir Comentario a una Issue",
      custom_id: "modal_submit_comment",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "number",
              label: "Número de Issue (#)",
              style: 1,
              placeholder: "Ej: 223",
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
              label: "Tu comentario",
              style: 2,
              placeholder: "Escribe aquí la respuesta, feedback o progreso...",
              required: true,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Modal Dialog: Cerrar una Issue
 */
export function getCloseModal() {
  return {
    type: 9,
    data: {
      title: "Cerrar Issue en GitHub",
      custom_id: "modal_submit_close",
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "number",
              label: "Número de Issue (#)",
              style: 1,
              placeholder: "Ej: 223",
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
              label: "Motivo del cierre (opcional)",
              style: 1,
              placeholder: "Ej: Resuelto en la build Pear OS 1.0.4",
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

  // Limpiar menciones de Discord
  let text = raw.replace(/<@!?[0-9]+>/g, "").replace(/^!issue\s*/i, "").trim();
  const lower = text.toLowerCase();

  // 1. Comando HELP / GUIA
  if (!text || lower === "help" || lower === "ayuda" || lower.includes("guia") || lower.includes("tutorial")) {
    return { action: "help" };
  }

  // 2. Comando CLOSE / CERRAR (ej: close 223 o cerrar #223 resuelto)
  const closeMatch = text.match(/\b(?:close|cerrar)\s+#?(\d+)(?:\s+([\s\S]+))?/i);
  if (closeMatch) {
    return {
      action: "close",
      issueNumber: parseInt(closeMatch[1], 10),
      reason: closeMatch[2]?.trim(),
    };
  }

  // 3. Comando COMMENT / COMENTAR (ej: comment 223 revisado y probado)
  const commentMatch = text.match(/\b(?:comment|comentar)\s+#?(\d+)\s+([\s\S]+)/i);
  if (commentMatch) {
    return {
      action: "comment",
      issueNumber: parseInt(commentMatch[1], 10),
      comment: commentMatch[2].trim(),
    };
  }

  // 4. Comando VIEW / VER / LISTAR
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

  // 5. Comando CREATE (debe incluir error o suggestion, y pulsar o inled)
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
