import { Env, LogEntry } from "./types";

const MAX_LOGS = 150;
const memoryLogs: LogEntry[] = [];

export function getRecentLogs(): LogEntry[] {
  return [...memoryLogs];
}

export function clearRecentLogs(): void {
  memoryLogs.length = 0;
}

export async function logEvent(
  _env: Env,
  entry: Omit<LogEntry, "id" | "timestamp">
): Promise<void> {
  try {
    const fullEntry: LogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    memoryLogs.unshift(fullEntry);
    if (memoryLogs.length > MAX_LOGS) {
      memoryLogs.length = MAX_LOGS;
    }

    console.log(`[IssueBot] [${fullEntry.level}] [${fullEntry.event}] ${fullEntry.message}`, {
      user: fullEntry.user,
      org: fullEntry.org,
      details: fullEntry.details,
    });
  } catch (err) {
    console.error("Error logging event:", err);
  }
}
