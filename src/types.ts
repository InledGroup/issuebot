export interface Env {
  DISCORD_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  BOT_USER_ID?: string;

  PULSAR_PROJECT_ID: string;
  PULSAR_BOARD_URL: string;
  PULSAR_TIPO_FIELD_ID: string;
  PULSAR_TIPO_ERROR_ID: string;
  PULSAR_TIPO_IDEA_ID: string;

  INLED_PROJECT_ID: string;
  INLED_BOARD_URL: string;

  DISCORD_GATEWAY: DurableObjectNamespace;
  LOG_STORE: DurableObjectNamespace;
}

export type LogLevel = "INFO" | "SUCCESS" | "WARN" | "ERROR";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  event: string;
  user?: string;
  org?: "Inled-Pulsar-OS" | "InledGroup" | "General";
  message: string;
  details?: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: DiscordUser;
  mentions?: DiscordUser[];
}

export interface ProjectIssueItem {
  id: string;
  title: string;
  url?: string;
  state?: string;
  type?: string;
  number?: number;
}
