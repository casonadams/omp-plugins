import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";

export interface GuardProductionConfig {
  namespaces?: string[];
  projects?: string[];
  clusters?: string[];
  markers?: string[];
}

export interface GuardConfig {
  production?: GuardProductionConfig;
  allowlist?: string[];
}

export const DEFAULT_PRODUCTION_MARKERS = ["prod", "prd", "production", "live", "kube-system"];

export function findGuardConfigFile(cwd: string = process.cwd()): string | undefined {
  const home = os.homedir();
  const candidates = [
    path.join(cwd, ".guard.yml"),
    path.join(cwd, ".guard.yaml"),
    path.join(home, ".config", "omp-guard", "config.yml"),
    path.join(home, ".config", "omp-guard", "config.yaml"),
    path.join(home, ".guard.yml"),
    path.join(home, ".guard.yaml"),
  ];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return file;
      }
    } catch {
      // Continue searching
    }
  }
  return undefined;
}

export function loadGuardConfig(cwd?: string): GuardConfig {
  const configFile = findGuardConfigFile(cwd);
  if (!configFile) return {};

  try {
    const raw = fs.readFileSync(configFile, "utf8");
    const parsed = YAML.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as GuardConfig;
    }
  } catch {
    // If config file is unparseable, return empty default
  }
  return {};
}

export function resolveProductionMarkers(config: GuardConfig): string[] {
  const custom = [
    ...(config.production?.markers ?? []),
    ...(config.production?.namespaces ?? []),
    ...(config.production?.projects ?? []),
    ...(config.production?.clusters ?? []),
  ]
    .map((m) => m.replace(/[*^$]/g, "").trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_PRODUCTION_MARKERS, ...custom]));
}

export function isAllowlistedCommand(command: string, config: GuardConfig): boolean {
  if (!config.allowlist?.length) return false;
  const trimmed = command.trim();
  for (const pattern of config.allowlist) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(trimmed)) return true;
    } catch {
      // Skip invalid regexes
    }
  }
  return false;
}
