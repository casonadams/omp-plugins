export type ShellType = "zsh" | "bash";

export interface ShellHistoryOptions {
  shell?: ShellType | "auto";
  historyFile?: string;
  extendedHistory?: boolean;
  ignoreSpace?: boolean;
  ignoreDups?: boolean;
  appendTimestamp?: boolean;
}

export interface ResolvedHistoryTarget {
  shellType: ShellType;
  historyPath: string;
  extendedHistory: boolean;
  appendTimestamp: boolean;
}

export interface ToolResultEvent {
  type?: string;
  toolName: string;
  toolCallId?: string;
  input?: {
    command?: unknown;
    [key: string]: unknown;
  };
  content?: unknown;
  details?: unknown;
  isError?: boolean;
}

export interface ExtensionContext {
  hasUI?: boolean;
  cwd?: string;
  ui?: {
    notify?(message: string, level?: "info" | "warning" | "error"): void;
  };
}

export interface PiExtensionAPI {
  on(
    event: "tool_result",
    handler: (event: ToolResultEvent, ctx?: ExtensionContext) => Promise<void> | void,
  ): void;
}
