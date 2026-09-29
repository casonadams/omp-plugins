import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { completeSimple, type Api, type Model } from "@oh-my-pi/pi-ai";
import { GUARD_SYSTEM_PROMPT } from "./constants";
import type { ExtensionContext, GuardVerdict } from "./types";

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
  const [provider, modelId] = cleanSpec.includes("/")
    ? cleanSpec.split("/")
    : ["typesafe", cleanSpec];

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
  const [provider, modelId] = cleanSpec.split("/");
  return {
    id: modelId || "jev-latest",
    name: "TypeSafe jev",
    provider: provider || "typesafe",
    api: "typesafe",
    baseUrl: process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai",
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

export async function resolveGuardModel(ctx?: ExtensionContext): Promise<GuardModelResolution> {
  const model =
    ctx?.models?.resolve("@guard") ?? ctx?.models?.resolve("@judge") ?? fallbackResolveModel(ctx);

  if (!model) {
    return {
      block: true,
      reason:
        "No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
    };
  }

  let apiKey = await ctx?.modelRegistry?.getApiKey(model).catch(() => undefined);
  if (!apiKey && (model.api === "typesafe" || model.provider === "typesafe")) {
    apiKey = process.env.TYPESAFE_API_KEY;
  }
  const isKeyless = isKeylessModel(model);

  if (!apiKey && !isKeyless) {
    return {
      block: true,
      reason: `Guard model "${model.provider}/${model.id}" requires an API key, but none was found.`,
    };
  }

  return { model, apiKey: apiKey || (isKeyless ? "none" : undefined) };
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
              text: `<command_to_evaluate>\n${command}\n</command_to_evaluate>`,
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
      maxTokens: 256,
    },
  );

  const textBlock = response.content.find(
    (b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string",
  );
  if (!textBlock?.text.trim()) throw new Error("No text response received from guard model");

  return parseGuardOutput(textBlock.text);
}

export function parseSystemOneOutput(data: unknown): GuardVerdict {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response format from System One model");
  }

  const record = data as {
    answers?: {
      safety?: { type?: string; noul?: number };
      action?: { type?: string; choice?: string };
    };
  };

  const safety = record.answers?.safety?.noul;
  const action = record.answers?.action?.choice || "ambiguous";

  if (typeof safety !== "number" || Number.isNaN(safety)) {
    throw new Error("Missing safety probability in System One response");
  }

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

export async function evaluateSystemOneSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<GuardVerdict> {
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

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      state: command,
      model: model.id || "jev-latest",
      questions: {
        safety: {
          type: "noul",
          instructions:
            "Is this shell command safe to execute on a developer workstation without data loss, credential theft, system file deletion, or irreversible state corruption?",
        },
        action: {
          type: "choice",
          instructions: "Classify the scope and hazard level of this command.",
          criteria: {
            safe_local: "Local build, test, lint, diagnostic, or git inspection.",
            cloud_or_remote:
              "Cloud/cluster mutations (k8s, AWS, GCP, terraform) or remote git push/publication.",
            destructive:
              "Recursive file deletion, disk operations, permission rewrites, or system configuration edits.",
            ambiguous: "Obfuscated, complex chained commands, or unclear blast radius.",
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
  return parseSystemOneOutput(data);
}

export async function evaluateCommandSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GuardVerdict> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    if (isDecisionModel(model)) {
      return await evaluateSystemOneSafety(model, apiKey, command, controller.signal, fetchImpl);
    }
    return await evaluateChatSafety(model, apiKey, command, controller.signal);
  } catch (err) {
    return {
      safe: false,
      reason: `Guard model check failed (${err instanceof Error ? err.message : String(err)}). Command not verified safe.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
