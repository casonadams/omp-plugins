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

function collectStringArray(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  return source
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

export function resolveProductionMarkers(config: GuardConfig): string[] {
  const custom = [
    ...collectStringArray(config.production?.markers),
    ...collectStringArray(config.production?.namespaces),
    ...collectStringArray(config.production?.projects),
    ...collectStringArray(config.production?.clusters),
  ]
    .map((m) => m.replace(/[*^$]/g, "").trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_PRODUCTION_MARKERS, ...custom]));
}

export function isAllowlistedCommand(command: string, config: GuardConfig): boolean {
  if (!Array.isArray(config.allowlist) || config.allowlist.length === 0) return false;
  const trimmed = command.trim();
  if (!trimmed) return false;

  for (const pattern of config.allowlist) {
    if (typeof pattern !== "string") continue;
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) continue;

    try {
      const regex = new RegExp(trimmedPattern, "i");
      if (regex.test(trimmed)) return true;
    } catch {
      // Skip invalid regexes
    }
  }
  return false;
}
