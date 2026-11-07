import { DurableObject } from "cloudflare:workers";
import { Env, LogEntry } from "./types";

const MAX_LOGS = 150;

export class LogStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async readLogs(): Promise<LogEntry[]> {
    return (await this.ctx.storage.get<LogEntry[]>("logs")) ?? [];
  }

  async appendLog(entry: LogEntry): Promise<void> {
    const logs = await this.readLogs();
    logs.unshift(entry); // El más reciente primero
    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS;
    }
    await this.ctx.storage.put("logs", logs);
  }

  async clearLogs(): Promise<void> {
    await this.ctx.storage.put("logs", []);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/logs")) {
      return Response.json(await this.readLogs());
    }

    if (request.method === "POST" && url.pathname.endsWith("/add")) {
      const entry = (await request.json()) as LogEntry;
      await this.appendLog(entry);
      return Response.json({ ok: true });
    }

    if (request.method === "DELETE" && url.pathname.endsWith("/clear")) {
      await this.clearLogs();
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}

export async function logEvent(
  env: Env,
  entry: Omit<LogEntry, "id" | "timestamp">
): Promise<void> {
  try {
    const fullEntry: LogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const store = env.LOG_STORE.get(env.LOG_STORE.idFromName("global"));
    await store.fetch(new Request("https://internal/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullEntry),
    }));
  } catch (err) {
    console.error("Error writing log entry:", err);
  }
}
