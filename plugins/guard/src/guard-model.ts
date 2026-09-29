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

export async function evaluateCommandSafety(
  model: Model<Api>,
  apiKey: string | undefined,
  command: string,
): Promise<GuardVerdict> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
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
        signal: controller.signal,
        temperature: 0.0,
        maxTokens: 256,
      },
    );

    const textBlock = response.content.find(
      (b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string",
    );
    if (!textBlock?.text.trim()) throw new Error("No text response received from guard model");

    return parseGuardOutput(textBlock.text);
  } catch (err) {
    return {
      safe: false,
      reason: `Guard model check failed (${err instanceof Error ? err.message : String(err)}). Command not verified safe.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
