import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { GuardConfig } from "./config";

export type DecisionTargetKey = "safe_auto_allow" | "ask_confirmation" | "hard_deny";

export type DecisionSource =
  | "allowlist"
  | "critical_danger_regex"
  | "model_safe"
  | "user_proceed"
  | "user_cancel"
  | "user_feedback"
  | "headless_block";

export interface JevDecisionOption {
  label: "A" | "B" | "C";
  key: DecisionTargetKey;
  description: string;
}

export interface JevDecisionRecord {
  id: string;
  timestamp: string;
  state: {
    command: string;
    language: string;
    cwd: string;
    production_markers: string[];
  };
  question: string;
  options: JevDecisionOption[];
  model_verdict?: {
    model?: string;
    safe: boolean;
    action?: string;
    reason: string;
    raw?: Record<string, unknown>;
  };
  target: {
    label: "A" | "B" | "C";
    key: DecisionTargetKey;
    source: DecisionSource;
    feedback?: string | null;
    latency_ms: number;
  };
}

export const DEFAULT_JEV_QUESTION = "Classify the safety policy for this tool execution.";

export const DEFAULT_JEV_OPTIONS: JevDecisionOption[] = [
  {
    label: "A",
    key: "safe_auto_allow",
    description: "Benign local operation; auto-execute without prompting.",
  },
  {
    label: "B",
    key: "ask_confirmation",
    description: "Risky, state-altering, or ambiguous; prompt user for confirmation.",
  },
  {
    label: "C",
    key: "hard_deny",
    description: "Violates safety policy or malicious; deny execution.",
  },
];

export const TARGET_LABELS: Record<DecisionTargetKey, "A" | "B" | "C"> = {
  safe_auto_allow: "A",
  ask_confirmation: "B",
  hard_deny: "C",
};

export function resolveTelemetryPath(
  config?: GuardConfig,
  homeDir: string = os.homedir(),
): string {
  if (process.env.GUARD_TELEMETRY_PATH) {
    return process.env.GUARD_TELEMETRY_PATH;
  }
  if (config?.telemetry?.path) {
    return config.telemetry.path;
  }
  return path.join(homeDir, ".omp", "guard", "decisions.jsonl");
}

export function isTelemetryEnabled(config?: GuardConfig): boolean {
  if (
    process.env.GUARD_TELEMETRY_DISABLED === "1" ||
    process.env.GUARD_TELEMETRY_DISABLED === "true"
  ) {
    return false;
  }
  return config?.telemetry?.enabled !== false;
}

export function createDecisionRecord(params: {
  command: string;
  language?: string;
  cwd?: string;
  markers?: string[];
  modelVerdict?: {
    model?: string;
    safe: boolean;
    action?: string;
    reason: string;
    raw?: Record<string, unknown>;
  };
  targetKey: DecisionTargetKey;
  source: DecisionSource;
  feedback?: string | null;
  latencyMs: number;
  id?: string;
  timestamp?: string;
}): JevDecisionRecord {
  const targetKey = params.targetKey;
  return {
    id: params.id || crypto.randomUUID(),
    timestamp: params.timestamp || new Date().toISOString(),
    state: {
      command: params.command,
      language: params.language || "bash",
      cwd: params.cwd || process.cwd(),
      production_markers: params.markers || [],
    },
    question: DEFAULT_JEV_QUESTION,
    options: DEFAULT_JEV_OPTIONS,
    ...(params.modelVerdict ? { model_verdict: params.modelVerdict } : {}),
    target: {
      label: TARGET_LABELS[targetKey],
      key: targetKey,
      source: params.source,
      feedback: params.feedback ?? null,
      latency_ms: Math.max(0, Math.round(params.latencyMs)),
    },
  };
}

export function logGuardDecision(
  record: JevDecisionRecord,
  customPath?: string,
): void {
  try {
    const targetPath = customPath || resolveTelemetryPath();
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(targetPath, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Suppress telemetry write errors to prevent interrupting user commands
  }
}
