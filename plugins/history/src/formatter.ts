import type { ShellType } from "./types";

export interface FormatOptions {
  extendedHistory?: boolean;
  appendTimestamp?: boolean;
  timestamp?: number;
}

export function formatHistoryEntry(
  command: string,
  shellType: ShellType,
  options: FormatOptions = {},
): string {
  const trimmed = command.trimEnd();
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);

  if (shellType === "zsh") {
    if (options.extendedHistory !== false) {
      const lines = trimmed.split("\n");
      const formattedLines = lines.map((line, idx) =>
        idx < lines.length - 1 ? `${line}\\` : line,
      );
      return `: ${timestamp}:0;${formattedLines.join("\n")}\n`;
    }
    return `${trimmed}\n`;
  }

  if (options.appendTimestamp) {
    return `#${timestamp}\n${trimmed}\n`;
  }
  return `${trimmed}\n`;
}
