import { resolveTarget } from "./src/resolver";
import { HistorySyncer } from "./src/syncer";
import type {
  ExtensionContext,
  PiExtensionAPI,
  ShellHistoryOptions,
  ToolResultEvent,
} from "./src/types";

export {
  DEFAULT_BASH_HISTORY_FILE,
  DEFAULT_ZSH_HISTORY_FILE,
  ENV_HISTFILE,
  ENV_OMP_HISTORY_FILE,
  ENV_OMP_HISTORY_TARGET,
  ENV_OMP_SHELL_HISTORY_FILE,
  ENV_OMP_SHELL_HISTORY_TARGET,
  ENV_SHELL,
  FILE_MODE_RESTRICTIVE,
} from "./src/constants";
export { formatHistoryEntry, type FormatOptions } from "./src/formatter";
export { detectShellType, expandTilde, resolveTarget } from "./src/resolver";
export { HistorySyncer } from "./src/syncer";
export type * from "./src/types";

export function registerHistory(pi: PiExtensionAPI, options: ShellHistoryOptions = {}): void {
  const syncer = new HistorySyncer(options);

  pi.on("tool_result", async (event: ToolResultEvent, _ctx?: ExtensionContext): Promise<void> => {
    if (event.toolName !== "bash") return;
    if (event.isError === true) return;

    const command = typeof event.input?.command === "string" ? event.input.command : undefined;
    if (!command || !syncer.shouldSync(command)) return;

    const target = resolveTarget(options);
    await syncer.appendToHistory(command, target);
  });
}

export const registerShellHistory = registerHistory;

export default registerHistory;
