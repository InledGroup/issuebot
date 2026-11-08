import { Env } from "./types";

let cachedPublicKey: string | null = null;

function hexToUint8Array(hex: string): Uint8Array {
  const match = hex.match(/.{1,2}/g);
  if (!match) return new Uint8Array(0);
  return new Uint8Array(match.map((byte) => parseInt(byte, 16)));
}

/**
 * Resolves Discord Application Public Key (from env or lazily from Discord API using Bot Token)
 */
export async function getDiscordPublicKey(env: Env): Promise<string> {
  if (env.DISCORD_PUBLIC_KEY) {
    return env.DISCORD_PUBLIC_KEY.trim();
  }
  if (cachedPublicKey) {
    return cachedPublicKey;
  }
  const res = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch Discord application info (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { verify_key?: string };
  if (!data.verify_key) {
    throw new Error("Discord application object did not contain verify_key");
  }
  cachedPublicKey = data.verify_key;
  return cachedPublicKey;
}

/**
 * Cryptographically verifies an incoming Discord Interaction HTTP request using Ed25519 Web Crypto.
 */
export async function verifyDiscordRequest(
  request: Request,
  publicKeyHex: string,
  rawBody: string
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");

  if (!signature || !timestamp || !publicKeyHex) {
    return false;
  }

  try {
    const keyData = hexToUint8Array(publicKeyHex);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    const sigData = hexToUint8Array(signature);
    const data = new TextEncoder().encode(timestamp + rawBody);

    return await crypto.subtle.verify("Ed25519", key, sigData, data);
  } catch (err) {
    console.error("Discord signature verification error:", err);
    return false;
  }
}

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
