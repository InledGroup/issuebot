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
  replyToMessageId?: string
): Promise<Response> {
  const chunks = splitDiscordMessage(content, 1900);
  let lastRes: Response | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const payload: Record<string, unknown> = {
      content: chunk,
      allowed_mentions: { replied_user: i === 0 },
    };

    if (i === 0 && replyToMessageId) {
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

    lastRes = res;
  }

  return lastRes!;
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

    // Si el usuario no indica tipo, filterType es undefined y devuelve todas (errores, ideas, ayuda...)
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
