export interface Env {
  DISCORD_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  DISCORD_PUBLIC_KEY?: string;
  BOT_USER_ID?: string;

  PULSAR_PROJECT_ID: string;
  PULSAR_BOARD_URL: string;
  PULSAR_TIPO_FIELD_ID: string;
  PULSAR_TIPO_ERROR_ID: string;
  PULSAR_TIPO_IDEA_ID: string;
  PULSAR_STATUS_FIELD_ID?: string;
  PULSAR_STATUS_DONE_ID?: string;

  INLED_PROJECT_ID: string;
  INLED_BOARD_URL: string;
  INLED_STATUS_FIELD_ID?: string;
  INLED_STATUS_DONE_ID?: string;
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

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number; // 2: command, 3: message component (button), 5: modal submit
  data?: {
    id?: string;
    name?: string;
    options?: Array<{
      name: string;
      type: number;
      value?: any;
      options?: Array<{
        name: string;
        type: number;
        value?: any;
      }>;
    }>;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    components?: Array<{
      type: number;
      components: Array<{
        type: number;
        custom_id: string;
        value: string;
      }>;
    }>;
  };
  channel_id?: string;
  guild_id?: string;
  token: string;
  user?: DiscordUser;
  member?: {
    user: DiscordUser;
  };
  message?: DiscordMessage;
}
