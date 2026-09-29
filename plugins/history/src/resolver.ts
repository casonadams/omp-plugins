import {
  DEFAULT_BASH_HISTORY_FILE,
  DEFAULT_ZSH_HISTORY_FILE,
  ENV_HISTFILE,
  ENV_OMP_HISTORY_FILE,
  ENV_OMP_HISTORY_TARGET,
  ENV_OMP_SHELL_HISTORY_FILE,
  ENV_OMP_SHELL_HISTORY_TARGET,
  ENV_SHELL,
} from "./constants";
import type { ResolvedHistoryTarget, ShellHistoryOptions, ShellType } from "./types";

function parseShellTarget(env: Record<string, string | undefined>): ShellType | undefined {
  const target = (env[ENV_OMP_HISTORY_TARGET] || env[ENV_OMP_SHELL_HISTORY_TARGET])?.toLowerCase();
  if (target === "zsh" || target === "bash") {
    return target;
  }
  return undefined;
}

function parseFromEnvironment(env: Record<string, string | undefined>): ShellType | undefined {
  const histfile = env[ENV_HISTFILE]?.toLowerCase();
  if (histfile?.includes("zsh")) return "zsh";
  if (histfile?.includes("bash")) return "bash";

  const shell = env[ENV_SHELL]?.toLowerCase();
  if (shell === "zsh" || shell?.endsWith("/zsh")) return "zsh";
  if (shell === "bash" || shell?.endsWith("/bash")) return "bash";

  return undefined;
}

export function detectShellType(
  options?: ShellHistoryOptions,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): ShellType {
  if (options?.shell && options.shell !== "auto") {
    return options.shell;
  }
  return (
    parseShellTarget(env) || parseFromEnvironment(env) || (platform === "darwin" ? "zsh" : "bash")
  );
}

export function expandTilde(filepath: string, homedir: string): string {
  if (!filepath.startsWith("~")) return filepath;
  if (filepath === "~") return homedir;
  if (filepath.startsWith("~/")) {
    return homedir ? `${homedir}${filepath.slice(1)}` : filepath;
  }
  return filepath;
}

export function resolveTarget(
  options?: ShellHistoryOptions,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  homedir: string = process.env.HOME || "",
): ResolvedHistoryTarget {
  const shellType = detectShellType(options, env, platform);
  const rawPath =
    options?.historyFile ||
    env[ENV_OMP_HISTORY_FILE] ||
    env[ENV_OMP_SHELL_HISTORY_FILE] ||
    env[ENV_HISTFILE] ||
    (shellType === "zsh" ? DEFAULT_ZSH_HISTORY_FILE : DEFAULT_BASH_HISTORY_FILE);
  const historyPath = expandTilde(rawPath, homedir);

  return {
    shellType,
    historyPath,
    extendedHistory: options?.extendedHistory ?? true,
    appendTimestamp: options?.appendTimestamp ?? false,
  };
}
