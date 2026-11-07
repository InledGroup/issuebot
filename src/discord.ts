import { DiscordMessage, Env } from "./types";

const DISCORD_API = "https://discord.com/api/v10";

export async function sendDiscordMessage(
  env: Env,
  channelId: string,
  content: string,
  replyToMessageId?: string
): Promise<Response> {
  const payload: Record<string, unknown> = {
    content,
    allowed_mentions: { replied_user: true },
  };

  if (replyToMessageId) {
    payload.message_reference = {
      message_id: replyToMessageId,
    };
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

  return res;
}

export type CommandIntent =
  | {
      action: "view";
      org: "pulsar" | "inled";
      filterType?: "Error" | "Idea";
    }
  | {
      action: "create";
      org: "pulsar" | "inled";
      type: "Error" | "Idea";
      title: string;
      body: string;
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

  // Comprobar si el mensaje menciona al bot o empieza con !issue / /issue
  const isMentioned = botUserId
    ? mentions.some((u) => u.id === botUserId) || raw.includes(`<@${botUserId}>`) || raw.includes(`<@!${botUserId}>`)
    : mentions.length > 0 || raw.toLowerCase().startsWith("!issue") || raw.toLowerCase().startsWith("/issue");

  if (!isMentioned && !raw.toLowerCase().includes("issuebot")) {
    return null;
  }

  // Limpiar menciones de Discord: <@123456789...>
  let text = raw.replace(/<@!?[0-9]+>/g, "").replace(/^!issue\s*/i, "").trim();
  const lower = text.toLowerCase();

  // 1. Comando VIEW
  if (lower.includes("view") || lower.includes("ver") || lower.includes("list")) {
    const org: "pulsar" | "inled" = lower.includes("inled") && !lower.includes("pulsar") ? "inled" : "pulsar";
    const filterType = lower.includes("error") || lower.includes("bug") ? "Error" : undefined;
    return {
      action: "view",
      org,
      filterType,
    };
  }

  // 2. Comando CREATE (debe incluir error o suggestion, y pulsar o inled)
  const isError = lower.includes("error") || lower.includes("bug");
  const isSuggestion = lower.includes("suggestion") || lower.includes("idea") || lower.includes("sugerencia");

  if (isError || isSuggestion) {
    const type: "Error" | "Idea" = isError ? "Error" : "Idea";
    const org: "pulsar" | "inled" = lower.includes("inled") && !lower.includes("pulsar") ? "inled" : "pulsar";

    // Extraer título limpio removiendo las palabras clave principales de control
    let cleanText = text
      .replace(/\b(error|bug|suggestion|idea|sugerencia)\b/gi, "")
      .replace(/\b(pulsar|inled)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText || cleanText.length < 3) {
      cleanText = text; // Fallback si quedó vacío
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
