import { Env } from "./types";

/**
 * Computes an internal authentication token derived from DISCORD_BOT_TOKEN
 * that only this Cloudflare Worker runtime knows.
 */
export async function getInternalGatewayToken(env: Env): Promise<string> {
  const secret = env.DISCORD_BOT_TOKEN || "fallback-internal-secret";
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`issuebot-internal-auth:${secret}`)
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sanitizes any sensitive credentials (tokens, auth headers) from error messages or logs
 */
export function sanitizeOutput(text: string): string {
  if (!text) return "";
  return text
    .replace(/gho_[a-zA-Z0-9_]{10,}/g, "gho_[REDACTED]")
    .replace(/ghp_[a-zA-Z0-9_]{10,}/g, "ghp_[REDACTED]")
    .replace(/github_pat_[a-zA-Z0-9_]{10,}/g, "github_pat_[REDACTED]")
    .replace(/Bot\s+[a-zA-Z0-9._-]{20,}/gi, "Bot [REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/gi, "Bearer [REDACTED]");
}

/**
 * In-memory anti-spam rate limiter per Discord user
 * Allows max 3 issue creations per user per minute.
 */
const userCreateTimestamps = new Map<string, number[]>();

export function isRateLimited(userId: string, maxActions = 3, windowSeconds = 60): boolean {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const userTimes = userCreateTimestamps.get(userId) || [];

  const recent = userTimes.filter((ts) => now - ts < windowMs);

  if (recent.length >= maxActions) {
    userCreateTimestamps.set(userId, recent);
    return true;
  }

  recent.push(now);
  userCreateTimestamps.set(userId, recent);
  return false;
}
