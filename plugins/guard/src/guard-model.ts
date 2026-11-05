import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { completeSimple, JUDGMENT_CHAT_MAX_TOKENS, type Api, type Model } from "@oh-my-pi/pi-ai";
import { GUARD_ROLE_FALLBACKS, GUARD_SYSTEM_PROMPT } from "./constants";
import type { ExtensionContext, GuardModelCandidate, GuardVerdict } from "./types";
import {
  type GuardConfig,
  isAllowlistedCommand,
  loadGuardConfig,
  resolveProductionMarkers,
} from "./config";

export type GuardModelResolution =
  { model: Model<Api>; apiKey?: string } | { block: true; reason: string };

export function isKeylessModel(model: Model<Api>): boolean {
  return (
    model.api === "local-inference" ||
    model.provider === "ollama" ||
    model.provider === "local" ||
    model.provider === "apple" ||
    model.api === "mock" ||
    model.provider === "mock"
  );
}

export function isDecisionModel(model: Model<Api>): boolean {
  return model.api === "typesafe" || model.api === "openrouter-decisions" || model.kind === "judge";
}

export function getConfiguredModelRole(role: string): string | undefined {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".omp", "agent", "config.yml"),
    path.join(home, ".omp", "agent", "config.yaml"),
    path.join(home, ".omp", "config.yml"),
    path.join(home, ".omp", "config.yaml"),
  ];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, "utf8");
        try {
          const parsed = YAML.parse(content) as Record<string, unknown> | null;
          const modelRoles = parsed?.modelRoles as Record<string, unknown> | undefined;
          if (typeof modelRoles?.[role] === "string" && modelRoles[role].trim()) {
            return modelRoles[role].trim();
          }
        } catch {
          // Fallback to regex if YAML parsing fails
        }
        const match = content.match(new RegExp(`^\\s*${role}:\\s*['"]?([^'#\\s]+)['"]?`, "m"));
        if (match?.[1]) return match[1].trim();
      }
    } catch {
      // Ignore filesystem errors and continue searching
    }
  }
  return undefined;
}

function resolveConfiguredRoleName(): string | undefined {
  return (
    process.env.GUARD_MODEL ||
    getConfiguredModelRole("guard") ||
    getConfiguredModelRole("judge") ||
    (process.env.TYPESAFE_API_KEY ? "typesafe/jev-latest" : undefined)
  );
}

function resolveModelFromRegistry(
  cleanSpec: string,
  registry?: ExtensionContext["modelRegistry"],
): Model<Api> | undefined {
  if (!registry) return undefined;
  const slashIdx = cleanSpec.indexOf("/");
  const provider = slashIdx !== -1 ? cleanSpec.slice(0, slashIdx) : "typesafe";
  const modelId = slashIdx !== -1 ? cleanSpec.slice(slashIdx + 1) : cleanSpec;

  const reg = registry as {
    find?(provider: string, id: string): Model<Api> | undefined;
    getAvailable?(kind: string): Model<Api>[];
  };

  if (provider && modelId && typeof reg.find === "function") {
    const found = reg.find(provider, modelId);
    if (found) return found;
  }

  if (typeof reg.getAvailable === "function") {
    const all = reg.getAvailable("all");
    return all.find(
      (m) =>
        m.id === cleanSpec ||
        `${m.provider}/${m.id}` === cleanSpec ||
        (Boolean(provider) && m.provider === provider && m.id === modelId),
    );
  }

  return undefined;
}

function buildFallbackDescriptor(cleanSpec: string): Model<Api> | undefined {
  if (!cleanSpec.startsWith("typesafe/") && !cleanSpec.includes("jev")) {
    return undefined;
  }
  const slashIdx = cleanSpec.indexOf("/");
  const provider = slashIdx !== -1 ? cleanSpec.slice(0, slashIdx) : "typesafe";
  const modelId = slashIdx !== -1 ? cleanSpec.slice(slashIdx + 1) : "jev-latest";
  const isOrDecisions =
    provider === "openrouter-decisions" || (provider === "openrouter" && modelId.startsWith("~"));
  return {
    id: modelId || "jev-latest",
    name: "TypeSafe jev",
    provider: provider || "typesafe",
    api: isOrDecisions ? "openrouter-decisions" : "typesafe",
    baseUrl: isOrDecisions
      ? process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/alpha"
      : process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai",
    kind: "judge",
  } as unknown as Model<Api>;
}

function fallbackResolveModel(ctx?: ExtensionContext): Model<Api> | undefined {
  if (!ctx?.modelRegistry) return undefined;
  const roleName = resolveConfiguredRoleName();
  if (!roleName) return undefined;

  const cleanSpec = roleName.replace(/:[a-z0-9_-]+$/i, "");
  return (
    ctx?.models?.resolve(cleanSpec) ||
    resolveModelFromRegistry(cleanSpec, ctx?.modelRegistry) ||
    buildFallbackDescriptor(cleanSpec)
  );
}

async function resolveModelApiKey(
  model: Model<Api>,
  ctx?: ExtensionContext,
): Promise<string | undefined> {
  let apiKey = await ctx?.modelRegistry?.getApiKey(model).catch(() => undefined);
  if (!apiKey && (model.api === "typesafe" || model.provider === "typesafe")) {
    apiKey = process.env.TYPESAFE_API_KEY;
  }
  if (!apiKey && (model.api === "openrouter-decisions" || model.provider === "openrouter")) {
    apiKey = process.env.OPENROUTER_API_KEY;
  }
  return apiKey;
}

function resolveRoleModel(role: string, ctx?: ExtensionContext): Model<Api> | undefined {
  const model = ctx?.models?.resolve(role);
  if (!model && role === "@guard") {
    return fallbackResolveModel(ctx);
  }
  return model;
}

export async function resolveGuardCandidates(
  ctx?: ExtensionContext,
): Promise<GuardModelCandidate[] | { block: true; reason: string }> {
  const candidates: GuardModelCandidate[] = [];
  let firstResolvedModel: Model<Api> | undefined;

  for (const role of GUARD_ROLE_FALLBACKS) {
    const model = resolveRoleModel(role, ctx);
    if (!model) continue;

    firstResolvedModel ??= model;

    const isDuplicate = candidates.some(
      (c) => c.model.provider === model.provider && c.model.id === model.id,
    );
    if (isDuplicate) continue;

    const apiKey = await resolveModelApiKey(model, ctx);
    const isKeyless = isKeylessModel(model);

    if (!apiKey && !isKeyless) continue;

    candidates.push({
      model,
      apiKey: apiKey || (isKeyless ? "none" : undefined),
      role,
    });
  }

  if (candidates.length > 0) {
    return candidates;
  }

  if (firstResolvedModel) {
    return {
      block: true,
      reason: `Guard model "${firstResolvedModel.provider}/${firstResolvedModel.id}" requires an API key, but none was found.`,
    };
  }

  return {
    block: true,
    reason:
      "No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
  };
}

export async function resolveGuardModel(ctx?: ExtensionContext): Promise<GuardModelResolution> {
  const candidates = await resolveGuardCandidates(ctx);
  if ("block" in candidates) {
    return candidates;
  }
  return { model: candidates[0].model, apiKey: candidates[0].apiKey };
}

export function parseGuardOutput(text: string): GuardVerdict {
  const clean = text
    .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "")
    .trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(clean.slice(start, end + 1)) as {
        safe?: boolean;
        action?: string;
        reason?: string;
      };
      if (typeof parsed.safe === "boolean") {
        const action =
          typeof parsed.action === "string" && parsed.action.trim()
            ? parsed.action.trim()
            : undefined;
        return {
          safe: parsed.safe,
          ...(action ? { action } : {}),
          reason:
            typeof parsed.reason === "string" && parsed.reason.trim()
              ? parsed.reason.trim()
              : parsed.safe
                ? "Command verified safe."
                : "Potential security risk detected.",
        };
      }
    } catch {
      // Fall through to heuristic recovery below
    }
  }

  const lower = clean.toLowerCase();
  const isSafe =
    (lower.includes('"safe": true') || lower.includes("safe: true")) && !lower.includes("unsafe");
  const fallbackReason = clean
    .replace(/```(?:json)?/gi, "")
    .replace(/[{}"]/g, "")
    .trim();

  return {
    safe: isSafe,
    reason: fallbackReason || "Potential security risk detected.",
  };
}

async function evaluateChatSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
  signal: AbortSignal,
  language: string = "bash",
): Promise<GuardVerdict> {
  const response = await completeSimple(
    model,
    {
      systemPrompt: [GUARD_SYSTEM_PROMPT],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `<command_to_evaluate language="${language}">\n${command}\n</command_to_evaluate>`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: apiKey || (isKeylessModel(model) ? "none" : undefined),
      signal,
      temperature: 0.0,
      maxTokens: JUDGMENT_CHAT_MAX_TOKENS,
      disableReasoning: true,
    },
  );

  const textBlock = response.content.find(
    (b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string",
  );
  if (!textBlock?.text.trim()) throw new Error("No text response received from guard model");

  const verdict = parseGuardOutput(textBlock.text);
  verdict.model = model.id;
  return verdict;
}

function evaluateP1(answers: Record<string, any>): GuardVerdict | undefined {
  const prodRisk = answers.p1_prod_impact?.noul;
  if (typeof prodRisk === "number" && !Number.isNaN(prodRisk) && prodRisk > 0.05) {
    const pct = Math.round(prodRisk * 100);
    return {
      safe: false,
      action: "production_mutation",
      reason: `Priority 1 alert: Potential production infrastructure mutation detected (risk: ${pct}%).`,
    };
  }
  return undefined;
}

function evaluateP2(answers: Record<string, any>): GuardVerdict | undefined {
  const maliciousRisk = answers.p2_malicious?.noul;
  if (typeof maliciousRisk === "number" && !Number.isNaN(maliciousRisk) && maliciousRisk > 0.1) {
    const pct = Math.round(maliciousRisk * 100);
    return {
      safe: false,
      action: "security_violation",
      reason: `Priority 2 alert: Potential malicious activity or secret exfiltration detected (risk: ${pct}%).`,
    };
  }
  return undefined;
}

function evaluateP3(answers: Record<string, any>): GuardVerdict | undefined {
  const localImpact = answers.p3_local_impact?.choice;
  if (localImpact) {
    const isSafe = localImpact === "safe_local" || localImpact === "cache_cleanup";
    return {
      safe: isSafe,
      action: localImpact,
      reason: isSafe
        ? "Command verified safe by System One."
        : `Priority 3 alert: Local workspace impact classified as [${localImpact}].`,
    };
  }
  return undefined;
}

function evaluateLegacyAnswer(answers: Record<string, any>): GuardVerdict {
  if (typeof answers.safety?.noul === "number" && !Number.isNaN(answers.safety.noul)) {
    const safety = answers.safety.noul;
    const action = answers.action?.choice || "ambiguous";
    const isSafe = safety >= 0.85 && action === "safe_local";
    const pct = Math.round(safety * 100);
    return {
      safe: isSafe,
      action,
      reason: isSafe
        ? "Command verified safe by System One."
        : `System One flagged as [${action}] (safety: ${pct}%).`,
    };
  }
  throw new Error("Missing safety probability in System One response");
}

export function parseSystemOneOutput(data: unknown): GuardVerdict {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response format from System One model");
  }

  const record = data as { answers?: Record<string, any> };
  const answers = record.answers || {};

  if (answers.p3_local_impact !== undefined) {
    const p1 = answers.p1_prod_impact?.noul;
    const p2 = answers.p2_malicious?.noul;
    if (typeof p1 !== "number" || Number.isNaN(p1) || typeof p2 !== "number" || Number.isNaN(p2)) {
      throw new Error("Missing or invalid P1/P2 risk probability in System One response");
    }
  }

  const verdict = (
    evaluateP1(answers) ||
    evaluateP2(answers) ||
    evaluateP3(answers) ||
    evaluateLegacyAnswer(answers)
  );
  verdict.rawAnswers = answers;
  return verdict;
}

export async function evaluateSystemOneSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
  signal: AbortSignal,
  languageOrFetch: string | typeof fetch = "bash",
  fetchImpl: typeof fetch = fetch,
  cwd?: string,
  guardConfig?: GuardConfig,
): Promise<GuardVerdict> {
  let language = "bash";
  let fetchFn = fetchImpl;
  let resolvedCwd = cwd;

  if (typeof languageOrFetch === "function") {
    fetchFn = languageOrFetch;
    if (typeof fetchImpl === "string") {
      resolvedCwd = fetchImpl;
    }
  } else if (typeof languageOrFetch === "string") {
    language = languageOrFetch;
  }

  const baseUrl = (
    model.baseUrl ||
    (model.api === "openrouter-decisions"
      ? "https://openrouter.ai/api/alpha"
      : "https://api.typesafe.ai")
  ).replace(/\/+$/, "");

  const endpoint =
    model.api === "openrouter-decisions" ? `${baseUrl}/decisions` : `${baseUrl}/v1/systemone`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const config = guardConfig || loadGuardConfig(resolvedCwd);
  const markers = resolveProductionMarkers(config);

  const res = await fetchFn(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      state: {
        command,
        language,
        cwd: resolvedCwd || process.cwd(),
        production_markers: markers,
      },
      model: model.id || "jev-latest",
      questions: {
        p1_prod_impact: {
          type: "noul",
          instructions:
            "Priority 1 - Production Safety: Does this command or script alter, delete, restart, or mutate production infrastructure, live cloud resources (e.g. gcloud, aws, terraform), production Kubernetes workloads/namespaces, or production databases matching the specified production_markers?",
        },
        p2_malicious: {
          type: "noul",
          instructions:
            "Priority 2 - Malicious Activity: Does this command or script attempt credential exfiltration, secret theft (reading ~/.ssh, ~/.aws, .env, tokens), privilege escalation, arbitrary remote script piping, or host tampering?",
        },
        p3_local_impact: {
          type: "choice",
          instructions:
            "Priority 3 - Local Workspace: Classify the effect of this command on the local developer environment.",
          criteria: {
            safe_local:
              "Benign read-only inspection, compiling, testing, linting, or editing inside git-tracked project files.",
            cache_cleanup:
              "Cleaning temporary project build artifacts, target directories, or cache files.",
            destructive_wipe:
              "Irreversible local deletion, wiping git history (reset --hard), or removing uncommitted source work.",
            ambiguous: "Obfuscated code, dynamic evaluation, or unclear blast radius.",
          },
        },
      },
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`System One API ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  const verdict = parseSystemOneOutput(data);
  verdict.model = model.id || "jev-latest";
  return verdict;
}

export async function evaluateCommandSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
  languageOrFetch: string | typeof fetch = "bash",
  fetchImpl: typeof fetch = fetch,
  cwd?: string,
  guardConfig?: GuardConfig,
): Promise<GuardVerdict> {
  const language = typeof languageOrFetch === "string" ? languageOrFetch : "bash";
  const fetchFn = typeof languageOrFetch === "function" ? languageOrFetch : fetchImpl;

  const config = guardConfig || loadGuardConfig(cwd);
  if (isAllowlistedCommand(command, config)) {
    return {
      safe: true,
      action: "allowlisted",
      reason: "Command matched allowlist pattern in .guard.yml.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    if (isDecisionModel(model)) {
      return await evaluateSystemOneSafety(
        model,
        apiKey,
        command,
        controller.signal,
        language,
        fetchFn,
        cwd,
        config,
      );
    }
    return await evaluateChatSafety(model, apiKey, command, controller.signal, language);
  } catch (err) {
    return {
      safe: false,
      reason: `Guard model check failed (${err instanceof Error ? err.message : String(err)}). Command not verified safe.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function evaluateCommandSafetyWithFallback(
  candidates: GuardModelCandidate[],
  command: string,
  languageOrFetch: string | typeof fetch = "bash",
  fetchImpl: typeof fetch = fetch,
  cwd?: string,
  guardConfig?: GuardConfig,
): Promise<GuardVerdict> {
  let lastVerdict: GuardVerdict | undefined;

  for (const candidate of candidates) {
    const verdict = await evaluateCommandSafety(
      candidate.model,
      candidate.apiKey,
      command,
      languageOrFetch,
      fetchImpl,
      cwd,
      guardConfig,
    );
    if (!verdict.model) {
      verdict.model = candidate.model.id || candidate.role;
    }
    if (!verdict.reason.startsWith("Guard model check failed")) {
      return verdict;
    }
    lastVerdict = verdict;
  }

  return (
    lastVerdict ?? {
      safe: false,
      reason: "Guard model check failed. Command not verified safe.",
    }
  );
}
