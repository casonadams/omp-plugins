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

export interface GuardTelemetryConfig {
  enabled?: boolean;
  path?: string;
}

export interface GuardPreviewConfig {
  namespaces?: string[];
  domains?: string[];
  clusters?: string[];
  markers?: string[];
}

export interface GuardConfig {
  production?: GuardProductionConfig;
  preview?: GuardPreviewConfig;
  allowlist?: string[];
  telemetry?: GuardTelemetryConfig;
}

export const DEFAULT_PRODUCTION_MARKERS = ["prod", "prd", "production", "live", "kube-system"];
export const DEFAULT_PREVIEW_MARKERS = ["pr-", "preview", "review-app"];

export function findGuardConfigFile(
  cwd: string = process.cwd(),
  homeDir: string = os.homedir(),
): string | undefined {
  const home = homeDir;
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

export function loadGuardConfig(cwd?: string, homeDir?: string): GuardConfig {
  const configFile = findGuardConfigFile(cwd, homeDir);
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

function extractCleanMarkers(
  sources: (unknown[] | undefined)[],
  defaults: readonly string[],
): string[] {
  const custom = sources
    .flatMap((src) => collectStringArray(src))
    .map((m) => m.replace(/[*^$]/g, "").trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...defaults, ...custom]));
}

function resolveEnvironmentMarkers(config: GuardConfig, type: "production" | "preview"): string[] {
  if (type === "production") {
    return extractCleanMarkers(
      [
        config.production?.markers,
        config.production?.namespaces,
        config.production?.projects,
        config.production?.clusters,
      ],
      DEFAULT_PRODUCTION_MARKERS,
    );
  }
  return extractCleanMarkers(
    [
      config.preview?.markers,
      config.preview?.namespaces,
      config.preview?.domains,
      config.preview?.clusters,
    ],
    DEFAULT_PREVIEW_MARKERS,
  );
}

export function resolveProductionMarkers(config: GuardConfig): string[] {
  return resolveEnvironmentMarkers(config, "production");
}

export function resolvePreviewMarkers(config: GuardConfig): string[] {
  return resolveEnvironmentMarkers(config, "preview");
}

function matchesWildcardPattern(value: string, pattern: string): boolean {
  const regexStr = "^" + pattern.replace(/\*/g, ".*") + "$";
  return new RegExp(regexStr, "i").test(value);
}

function matchFlagValues(command: string, flagRegex: RegExp): string[] {
  const matches = command.match(flagRegex);
  if (!matches) return [];
  return matches.map((m) => m.replace(flagRegex, "$1").toLowerCase());
}

function matchesProductionFlag(
  values: string[],
  markers: string[],
  patterns: string[],
  matchMode: "exact" | "prefix" | "substring" = "exact",
): boolean {
  return values.some(
    (v) =>
      markers.some((m) =>
        matchMode === "substring"
          ? v.includes(m)
          : matchMode === "prefix"
            ? v === m || v.startsWith(m)
            : v === m,
      ) || patterns.some((p) => matchesWildcardPattern(v, p)),
  );
}

function matchesHostUrl(command: string, predicate: (host: string) => boolean): boolean {
  const hostMatch = command.match(/https?:\/\/([^\s/'"]+)/gi);
  if (!hostMatch) return false;
  return hostMatch.some((url) => predicate(url.replace(/^https?:\/\//i, "").toLowerCase()));
}

export function isCommandTargetingProduction(command: string, config: GuardConfig): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  const prodMarkers = resolveProductionMarkers(config);
  const prodNamespaces = collectStringArray(config.production?.namespaces);
  const prodClusters = collectStringArray(config.production?.clusters);
  const prodProjects = collectStringArray(config.production?.projects);

  const nsVals = matchFlagValues(trimmed, /(?:-n\s+|--namespace(?:=|\s+))([^\s'"]+)/gi);
  if (matchesProductionFlag(nsVals, prodMarkers, prodNamespaces, "prefix")) return true;

  const ctxVals = matchFlagValues(trimmed, /(?:--context(?:=|\s+))([^\s'"]+)/gi);
  if (matchesProductionFlag(ctxVals, prodMarkers, prodClusters, "substring")) return true;

  const projVals = matchFlagValues(trimmed, /(?:--project(?:=|\s+))([^\s'"]+)/gi);
  if (matchesProductionFlag(projVals, prodMarkers, prodProjects, "substring")) return true;

  return matchesHostUrl(trimmed, (host) => /\b(prod|prd|production)\b/i.test(host));
}

function matchesPreviewNamespace(
  command: string,
  customNamespaces: string[],
  customMarkers: string[],
): boolean {
  const nsVals = matchFlagValues(command, /(?:-n\s+|--namespace(?:=|\s+))([^\s'"]+)/gi);
  return nsVals.some(
    (val) =>
      /^pr-[0-9a-z_-]+/i.test(val) ||
      /^preview-[0-9a-z_-]+/i.test(val) ||
      customNamespaces.some((p) => matchesWildcardPattern(val, p)) ||
      customMarkers.some((m) => val.includes(m.toLowerCase())),
  );
}

function matchesPreviewDomain(command: string, customDomains: string[]): boolean {
  return matchesHostUrl(
    command,
    (host) =>
      /^pr-[0-9a-z_-]+/i.test(host) ||
      host.includes(".dev.previ.dev") ||
      host.includes("preview") ||
      customDomains.some((p) => matchesWildcardPattern(host, p)),
  );
}

function matchesPreviewContext(command: string, customClusters: string[]): boolean {
  const ctxVals = matchFlagValues(command, /(?:--context(?:=|\s+))([^\s'"]+)/gi);
  return ctxVals.some(
    (val) =>
      val.includes("preview") ||
      /^pr-[0-9a-z_-]+/i.test(val) ||
      customClusters.some((p) => matchesWildcardPattern(val, p)),
  );
}

export function isCommandTargetingPreview(command: string, config: GuardConfig): boolean {
  const trimmed = command.trim();
  if (!trimmed || isCommandTargetingProduction(trimmed, config)) {
    return false;
  }

  const customNamespaces = collectStringArray(config.preview?.namespaces);
  const customDomains = collectStringArray(config.preview?.domains);
  const customClusters = collectStringArray(config.preview?.clusters);
  const customMarkers = collectStringArray(config.preview?.markers);

  return (
    matchesPreviewNamespace(trimmed, customNamespaces, customMarkers) ||
    matchesPreviewDomain(trimmed, customDomains) ||
    matchesPreviewContext(trimmed, customClusters) ||
    customMarkers.some((m) => Boolean(m) && trimmed.toLowerCase().includes(m.toLowerCase()))
  );
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
