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

export async function resolveGuardModel(ctx?: ExtensionContext): Promise<GuardModelResolution> {
  const model = ctx?.models?.resolve("@guard") ?? ctx?.models?.resolve("@judge");
  if (!model) {
    return {
      block: true,
      reason:
        "No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
    };
  }

  const apiKey = await ctx?.modelRegistry?.getApiKey(model).catch(() => undefined);
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
