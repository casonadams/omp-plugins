import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FILE_MODE_RESTRICTIVE } from "./constants";
import { formatHistoryEntry } from "./formatter";
import type { ResolvedHistoryTarget, ShellHistoryOptions } from "./types";

export class HistorySyncer {
  private lastCommand: string | undefined;
  private readonly options: ShellHistoryOptions;

  constructor(options: ShellHistoryOptions = {}) {
    this.options = options;
  }

  public shouldSync(command: string): boolean {
    if (!command || typeof command !== "string") {
      return false;
    }

    const ignoreSpace = this.options.ignoreSpace ?? true;
    if (ignoreSpace && (command.startsWith(" ") || command.startsWith("\t"))) {
      return false;
    }

    const trimmed = command.trim();
    if (trimmed.length === 0) {
      return false;
    }

    const ignoreDups = this.options.ignoreDups ?? true;
    if (ignoreDups && trimmed === this.lastCommand) {
      return false;
    }

    return true;
  }

  public recordSynced(command: string): void {
    this.lastCommand = command.trim();
  }

  public getLastCommand(): string | undefined {
    return this.lastCommand;
  }

  public async appendToHistory(
    command: string,
    target: ResolvedHistoryTarget,
    timestamp?: number,
  ): Promise<boolean> {
    try {
      const formatted = formatHistoryEntry(command, target.shellType, {
        extendedHistory: target.extendedHistory,
        appendTimestamp: target.appendTimestamp,
        timestamp,
      });

      const dir = path.dirname(target.historyPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(target.historyPath, formatted, {
        mode: FILE_MODE_RESTRICTIVE,
        flag: "a",
      });

      this.recordSynced(command);
      return true;
    } catch {
      return false;
    }
  }
}
