import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { describe, expect, test } from "bun:test";
import registerBashGuard, {
  CRITICAL_DANGER_REGEX,
  GUARD_ROLE_FALLBACKS,
  GUARD_SYSTEM_PROMPT,
  evaluateCommandSafety,
  evaluateCommandSafetyWithFallback,
  evaluateSystemOneSafety,
  getConfiguredModelRole,
  getCriticalDangerAudit,
  isAllowlistedCommand,
  isDecisionModel,
  loadGuardConfig,
  parseGuardOutput,
  parseSystemOneOutput,
  promptUser,
  resolveGuardCandidates,
  resolveGuardModel,
  resolveProductionMarkers,
} from "../index";

registerMockApi();
describe("CRITICAL_DANGER_REGEX", () => {
  test("flags destructive wipes immediately", () => {
    expect(CRITICAL_DANGER_REGEX.test("rm -rf /")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf ~")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf *")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf ..")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("git reset --hard HEAD~1")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("mkfs.ext4 /dev/sdb")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test("dd if=/dev/zero of=/dev/sda")).toBe(true);
    expect(CRITICAL_DANGER_REGEX.test(":(){ :|:& };:")).toBe(true);
  });

  test("does not match non-catastrophic commands that guard evaluates", () => {
    expect(CRITICAL_DANGER_REGEX.test("git status")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("cargo check")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("rm this.me")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("rm -rf ./target")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("bun test")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("git clean -fd")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("kubectl delete ns production")).toBe(false);
    expect(CRITICAL_DANGER_REGEX.test("psql -c 'DROP DATABASE production;'")).toBe(false);
  });
});

describe("registerBashGuard", () => {
  test("registers a tool_call event listener", () => {
    let registeredEvent: string | undefined;
    const mockPi = {
      on: (event: string) => {
        registeredEvent = event;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);
    expect(registeredEvent).toBe("tool_call");
  });

  test("blocks immediately if no guard or judge model configured", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "echo hello" } },
      {
        hasUI: false,
        models: {
          resolve: () => undefined,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "[Bash Guard] Blocked unsafe command (headless mode): No guard or judge model configured! Set `modelRoles.guard: <provider/model>` (or `modelRoles.judge`) in ~/.omp/agent/config.yml before executing shell commands.",
    });
  });
  test("allows execution of allowlisted command even when no guard model is configured", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-allowlist-test-"));
    try {
      fs.writeFileSync(path.join(tempDir, ".guard.yml"), "allowlist:\n  - '^git status$'\n");

      let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
      const mockPi = {
        on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
          toolCallHandler = handler;
        },
      };

      registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

      const result = await toolCallHandler!(
        { toolName: "bash", input: { command: "git status" } },
        {
          hasUI: false,
          cwd: tempDir,
          models: {
            resolve: () => undefined,
          },
        },
      );

      expect(result).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  test("presents askDialog with question, recommended Proceed, and Proceed preview with scroller", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    let dialogArg: unknown;
    const mockAskDialog = async (questions: unknown) => {
      dialogArg = questions;
      return {
        kind: "submit",
        results: [{ selectedOptions: ["Proceed"] }],
      };
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toBeUndefined(); // Allowed to proceed
    expect(Array.isArray(dialogArg)).toBe(true);
    const questions = dialogArg as Array<{
      header?: string;
      question: string;
      recommended?: number;
      options: Array<{ label: string; description?: string; preview?: string }>;
    }>;
    expect(questions[0]?.header).toBe("Bash Guard");
    expect(questions[0]?.question).toContain("Security Audit:");
    expect(questions[0]?.question).toContain(
      "Action: Recursively deletes root, home, parent, or wildcard files",
    );
    expect(questions[0]?.question).toContain(
      "Risk: Critical destructive filesystem wipe detected.",
    );
    expect(questions[0]?.recommended).toBe(0);
    expect(questions[0]?.options[0]?.label).toBe("Proceed");
    expect(questions[0]?.options[0]?.preview).toBe("```bash\nrm -rf /\n```");
    expect(questions[0]?.options[1]?.label).toBe("Cancel");
  });
  test("blocks execution when askDialog is cancelled", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockAskDialog = async () => ({
      kind: "submit",
      results: [{ selectedOptions: ["Cancel"] }],
    });

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "User denied execution: Critical destructive filesystem wipe detected. (Action: Recursively deletes root, home, parent, or wildcard files)",
    });
  });

  test("blocks execution with feedback when user provides custom input via Other", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockAskDialog = async () => ({
      kind: "submit",
      results: [{ selectedOptions: [], customInput: "don't delete production" }],
    });

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason: "User denied execution with feedback: don't delete production",
    });
  });

  test("falls back to confirm when select and askDialog are not available", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    let confirmed = false;
    const mockConfirm = async () => {
      confirmed = true;
      return true;
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          confirm: mockConfirm,
        },
      },
    );

    expect(confirmed).toBe(true);
    expect(result).toBeUndefined(); // Allowed by confirm
  });

  test("falls back to confirm denial when user declines", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockConfirm = async () => false;

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "rm -rf /" } },
      {
        hasUI: true,
        ui: {
          confirm: mockConfirm,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "User denied execution: Critical destructive filesystem wipe detected. (Action: Recursively deletes root, home, parent, or wildcard files)",
    });
  });

  test("ignores non-bash tool calls", async () => {
    let toolCallHandler: ((event: unknown, ctx?: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx?: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);
    const result = await toolCallHandler!({ toolName: "read_file" });
    expect(result).toBeUndefined();
  });

  test("ignores empty or whitespace commands", async () => {
    let toolCallHandler: ((event: unknown, ctx?: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx?: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);
    const result = await toolCallHandler!({ toolName: "bash", input: { command: "   " } });
    expect(result).toBeUndefined();
  });

  test("allows execution when guard model evaluates command as safe", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mock = createMockModel({
      responses: [
        { content: [{ type: "text", text: '{"safe": true, "reason": "Standard test workflow"}' }] },
      ],
    });

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "cargo test" } },
      {
        hasUI: true,
        models: {
          resolve: () => mock as unknown as Model<Api>,
        },
      },
    );

    expect(result).toBeUndefined();
  });

  test("prompts user with guard reason when command is unsafe", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mock = createMockModel({
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": false, "reason": "Remote git push modifies remote repository state."}',
            },
          ],
        },
      ],
    });

    let promptedReason: string | undefined;
    const mockAskDialog = async (questions: unknown) => {
      const qs = questions as Array<{ question: string }>;
      promptedReason = qs[0]?.question;
      return {
        kind: "submit",
        results: [{ selectedOptions: ["Cancel"] }],
      };
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "git push origin main" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
        models: {
          resolve: () => mock as unknown as Model<Api>,
        },
      },
    );

    expect(promptedReason).toContain("Remote git push modifies remote repository state.");
    expect(result).toEqual({
      block: true,
      reason: "User denied execution: Remote git push modifies remote repository state.",
    });
  });

  test("prompts user with action and reason when guard model provides both", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mock = createMockModel({
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": false, "action": "Pushes local commits to remote main branch", "reason": "Remote git push modifies remote repository state."}',
            },
          ],
        },
      ],
    });

    let promptedQuestion: string | undefined;
    const mockAskDialog = async (questions: unknown) => {
      const qs = questions as Array<{ question: string }>;
      promptedQuestion = qs[0]?.question;
      return {
        kind: "submit",
        results: [{ selectedOptions: ["Cancel"] }],
      };
    };

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "git push origin main" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
        models: {
          resolve: () => mock as unknown as Model<Api>,
        },
      },
    );

    expect(promptedQuestion).toContain("Action: Pushes local commits to remote main branch");
    expect(promptedQuestion).toContain("Risk: Remote git push modifies remote repository state.");
    expect(result).toEqual({
      block: true,
      reason:
        "User denied execution: Remote git push modifies remote repository state. (Action: Pushes local commits to remote main branch)",
    });
  });

  test("falls back to smol candidate when guard candidate evaluation fails", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const failingGuardMock = createMockModel({
      id: "failing-guard-model",
      responses: [{ content: [] }],
    });
    const smolMock = createMockModel({
      id: "smol-model",
      responses: [
        {
          content: [{ type: "text", text: '{"safe": true, "reason": "Smol verified safe"}' }],
        },
      ],
    });

    const result = await toolCallHandler!(
      { toolName: "bash", input: { command: "cargo test" } },
      {
        hasUI: true,
        models: {
          resolve: (role: string) => {
            if (role === "@guard") return failingGuardMock as unknown as Model<Api>;
            if (role === "@smol") return smolMock as unknown as Model<Api>;
            return undefined;
          },
        },
      },
    );

    // Safe command evaluated by fallback model should execute without blocking
    expect(result).toBeUndefined();
  });
});

describe("resolveGuardModel", () => {
  test("resolves judge role when guard role is unconfigured", async () => {
    const mockModel = { id: "judge-model", provider: "ollama", api: "local-inference" } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: (role: string) =>
          role === "@judge" ? (mockModel as unknown as Model<Api>) : undefined,
      },
    });
    expect("model" in res).toBe(true);
    if ("model" in res) {
      expect(res.model.id).toBe("judge-model");
    }
  });

  test("resolves mock model with fallback apiKey 'none'", async () => {
    const mockModel = { id: "mock-model", provider: "mock", api: "mock" } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
    });
    expect(res).toEqual({
      model: mockModel as unknown as Model<Api>,
      apiKey: "none",
    });
  });

  test("resolves ollama model with fallback apiKey 'none'", async () => {
    const mockModel = {
      id: "qwen2.5-coder:latest",
      provider: "ollama",
      api: "openai-responses",
    } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
      modelRegistry: {
        getApiKey: async () => undefined,
      },
    });
    expect(res).toEqual({
      model: mockModel as unknown as Model<Api>,
      apiKey: "none",
    });
  });

  test("preserves explicit apiKey for keyless model when available", async () => {
    const mockModel = {
      id: "qwen2.5-coder:latest",
      provider: "ollama",
      api: "openai-responses",
    } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
      modelRegistry: {
        getApiKey: async () => "custom-ollama-key",
      },
    });
    expect(res).toEqual({
      model: mockModel as unknown as Model<Api>,
      apiKey: "custom-ollama-key",
    });
  });
  test("fails when non-local model lacks API key", async () => {
    const mockModel = { id: "gpt-4", provider: "openai", api: "openai-chat" } as const;
    const res = await resolveGuardModel({
      models: { resolve: () => mockModel as unknown as Model<Api> },
      modelRegistry: { getApiKey: async () => undefined },
    });
    expect(res).toEqual({
      block: true,
      reason: 'Guard model "openai/gpt-4" requires an API key, but none was found.',
    });
  });
  test("resolves openrouter decision model and falls back to OPENROUTER_API_KEY", async () => {
    const originalEnv = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    try {
      const mockModel = {
        id: "~typesafe/jev-latest",
        provider: "openrouter",
        api: "openrouter-decisions",
      } as const;
      const res = await resolveGuardModel({
        models: { resolve: () => mockModel as unknown as Model<Api> },
        modelRegistry: { getApiKey: async () => undefined },
      });
      expect(res).toEqual({
        model: mockModel as unknown as Model<Api>,
        apiKey: "sk-or-test-key",
      });
    } finally {
      if (originalEnv !== undefined) {
        process.env.OPENROUTER_API_KEY = originalEnv;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  test("resolves smol role when guard and judge roles are unconfigured", async () => {
    const mockModel = { id: "smol-model", provider: "ollama", api: "local-inference" } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: (role: string) =>
          role === "@smol" ? (mockModel as unknown as Model<Api>) : undefined,
      },
    });
    expect("model" in res).toBe(true);
    if ("model" in res) {
      expect(res.model.id).toBe("smol-model");
    }
  });

  test("falls back from unauthenticated guard model to authenticated judge or smol model", async () => {
    const guardModel = { id: "gpt-4", provider: "openai", api: "openai-chat" } as const;
    const smolModel = { id: "smol-model", provider: "ollama", api: "local-inference" } as const;
    const res = await resolveGuardModel({
      models: {
        resolve: (role: string) => {
          if (role === "@guard") return guardModel as unknown as Model<Api>;
          if (role === "@smol") return smolModel as unknown as Model<Api>;
          return undefined;
        },
      },
      modelRegistry: {
        getApiKey: async (m) => (m.provider === "openai" ? undefined : "none"),
      },
    });
    expect("model" in res).toBe(true);
    if ("model" in res) {
      expect(res.model.id).toBe("smol-model");
    }
  });
});

describe("resolveGuardCandidates", () => {
  test("defines expected fallback role order", () => {
    expect(GUARD_ROLE_FALLBACKS).toEqual(["@guard", "@judge", "@smol"]);
  });

  test("includes multiple valid candidates in fallback order and deduplicates identical models", async () => {
    const guardModel = { id: "qwen-guard", provider: "ollama", api: "local-inference" } as const;
    const smolModel = { id: "gemini-smol", provider: "google", api: "google-gemini" } as const;
    const res = await resolveGuardCandidates({
      models: {
        resolve: (role: string) => {
          if (role === "@guard") return guardModel as unknown as Model<Api>;
          if (role === "@judge") return guardModel as unknown as Model<Api>; // Duplicate of @guard
          if (role === "@smol") return smolModel as unknown as Model<Api>;
          return undefined;
        },
      },
      modelRegistry: {
        getApiKey: async (m) => (m.provider === "google" ? "google-api-key" : undefined),
      },
    });

    expect(Array.isArray(res)).toBe(true);
    if (Array.isArray(res)) {
      expect(res).toHaveLength(2);
      expect(res[0].role).toBe("@guard");
      expect(res[0].model.id).toBe("qwen-guard");
      expect(res[1].role).toBe("@smol");
      expect(res[1].model.id).toBe("gemini-smol");
      expect(res[1].apiKey).toBe("google-api-key");
    }
  });

  test("returns block reason when all resolved candidates lack API keys", async () => {
    const guardModel = { id: "gpt-4", provider: "openai", api: "openai-chat" } as const;
    const res = await resolveGuardCandidates({
      models: {
        resolve: (role: string) =>
          role === "@guard" ? (guardModel as unknown as Model<Api>) : undefined,
      },
      modelRegistry: {
        getApiKey: async () => undefined,
      },
    });
    expect(res).toEqual({
      block: true,
      reason: 'Guard model "openai/gpt-4" requires an API key, but none was found.',
    });
  });
});

describe("evaluateCommandSafetyWithFallback", () => {
  test("returns immediate verdict when primary candidate succeeds", async () => {
    const primaryMock = createMockModel({
      responses: [
        { content: [{ type: "text", text: '{"safe": true, "reason": "Primary verified safe"}' }] },
      ],
    });
    const fallbackMock = createMockModel({
      responses: [
        {
          content: [{ type: "text", text: '{"safe": false, "reason": "Fallback should not run"}' }],
        },
      ],
    });

    const res = await evaluateCommandSafetyWithFallback(
      [
        { model: primaryMock as unknown as Model<Api>, apiKey: "none", role: "@guard" },
        { model: fallbackMock as unknown as Model<Api>, apiKey: "none", role: "@smol" },
      ],
      "git status",
    );

    expect(res).toEqual({ safe: true, reason: "Primary verified safe" });
  });

  test("returns intentional unsafe verdict from primary candidate without triggering fallback", async () => {
    const primaryMock = createMockModel({
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": false, "action": "Deletes production pod", "reason": "Mutates production environment"}',
            },
          ],
        },
      ],
    });
    const fallbackMock = createMockModel({
      responses: [
        {
          content: [{ type: "text", text: '{"safe": true, "reason": "Fallback should not run"}' }],
        },
      ],
    });

    const res = await evaluateCommandSafetyWithFallback(
      [
        { model: primaryMock as unknown as Model<Api>, apiKey: "none", role: "@guard" },
        { model: fallbackMock as unknown as Model<Api>, apiKey: "none", role: "@smol" },
      ],
      "kubectl delete pod prod-api",
    );

    expect(res).toEqual({
      safe: false,
      action: "Deletes production pod",
      reason: "Mutates production environment",
    });
  });

  test("falls back to secondary candidate when primary candidate evaluation fails with error", async () => {
    const failingMock = createMockModel({
      responses: [
        { content: [] }, // Will throw "No text response received from guard model"
      ],
    });
    const fallbackMock = createMockModel({
      responses: [
        { content: [{ type: "text", text: '{"safe": true, "reason": "Fallback succeeded"}' }] },
      ],
    });

    const res = await evaluateCommandSafetyWithFallback(
      [
        { model: failingMock as unknown as Model<Api>, apiKey: "none", role: "@guard" },
        { model: fallbackMock as unknown as Model<Api>, apiKey: "none", role: "@smol" },
      ],
      "npm test",
    );

    expect(res).toEqual({ safe: true, reason: "Fallback succeeded" });
  });

  test("returns last error when all candidates fail", async () => {
    const failingMock1 = createMockModel({ responses: [{ content: [] }] });
    const failingMock2 = createMockModel({ responses: [{ content: [] }] });

    const res = await evaluateCommandSafetyWithFallback(
      [
        { model: failingMock1 as unknown as Model<Api>, apiKey: "none", role: "@guard" },
        { model: failingMock2 as unknown as Model<Api>, apiKey: "none", role: "@smol" },
      ],
      "npm test",
    );

    expect(res.safe).toBe(false);
    expect(res.reason).toContain("Guard model check failed");
  });

  test("returns default failure when candidate list is empty", async () => {
    const res = await evaluateCommandSafetyWithFallback([], "npm test");
    expect(res).toEqual({
      safe: false,
      reason: "Guard model check failed. Command not verified safe.",
    });
  });
});

describe("evaluateCommandSafety", () => {
  test("evaluates command successfully with mock model", async () => {
    const mock = createMockModel({
      responses: [
        { content: [{ type: "text", text: '{"safe": true, "reason": "Verified safe test"}' }] },
      ],
    });
    const res = await evaluateCommandSafety(mock as unknown as Model<Api>, undefined, "npm test");
    expect(res).toEqual({ safe: true, reason: "Verified safe test" });
  });
});

describe("parseGuardOutput", () => {
  test("parses clean JSON format with action", () => {
    const res = parseGuardOutput(
      '{"safe": false, "action": "Deletes pod", "reason": "Mutates cluster state"}',
    );
    expect(res).toEqual({
      safe: false,
      action: "Deletes pod",
      reason: "Mutates cluster state",
    });
  });

  test("parses clean JSON format without action for backward compatibility", () => {
    const res = parseGuardOutput('{"safe": true, "reason": "read-only"}');
    expect(res).toEqual({ safe: true, reason: "read-only" });
  });
  test("strips thinking tags and parses wrapped JSON", () => {
    const res = parseGuardOutput(
      '<think>Evaluating...</think>\n{"safe": false, "reason": "deletes cluster pod"}',
    );
    expect(res).toEqual({ safe: false, reason: "deletes cluster pod" });

    const resThought = parseGuardOutput(
      '<thought>Reasoning about pod...</thought>\n{"safe": false, "reason": "deletes cluster pod"}',
    );
    expect(resThought).toEqual({ safe: false, reason: "deletes cluster pod" });

    const resThinking = parseGuardOutput(
      '<thinking>Analyzing...</thinking>\n{"safe": true, "reason": "diagnostics only"}',
    );
    expect(resThinking).toEqual({ safe: true, reason: "diagnostics only" });
  });

  test("uses default reasons when JSON reason is empty", () => {
    expect(parseGuardOutput('{"safe": true}')).toEqual({
      safe: true,
      reason: "Command verified safe.",
    });
    expect(parseGuardOutput('{"safe": false}')).toEqual({
      safe: false,
      reason: "Potential security risk detected.",
    });
  });

  test("recovers from malformed JSON quotes inside reason", () => {
    const res = parseGuardOutput('{"safe": false, "reason": "Command "kubectl" is unsafe"}');
    expect(res.safe).toBe(false);
    expect(res.reason).toContain("kubectl");
  });

  test("recovers safely from plain prose without throwing", () => {
    const res = parseGuardOutput(
      "UNSAFE: This command mutates cluster state by terminating a running pod.",
    );
    expect(res.safe).toBe(false);
    expect(res.reason).toContain("mutates cluster state");
  });
});

describe("promptUser", () => {
  test("returns blockedHeadless when hasUI is true but no dialog methods available", async () => {
    const result = await promptUser({ hasUI: true, ui: {} }, "git push", "Unsafe action");
    expect(result).toEqual({
      block: true,
      reason: "[Bash Guard] Blocked unsafe command (headless mode): Unsafe action",
    });
  });

  test("formats action and reason when SecurityAudit object is provided", async () => {
    const result = await promptUser({ hasUI: true, ui: {} }, "git push origin main", {
      action: "Pushes commits",
      reason: "Modifies remote state",
    });
    expect(result).toEqual({
      block: true,
      reason:
        "[Bash Guard] Blocked unsafe command (headless mode): Modifies remote state (Action: Pushes commits)",
    });
  });
});

describe("getCriticalDangerAudit", () => {
  test("describes rm -rf wipe pattern", () => {
    const audit = getCriticalDangerAudit("rm -rf /");
    expect(audit.action).toContain("Recursively deletes");
    expect(audit.reason).toContain("Critical destructive filesystem wipe");
  });

  test("describes git reset --hard pattern", () => {
    const audit = getCriticalDangerAudit("git reset --hard HEAD~1");
    expect(audit.action).toContain("Resets git working tree");
    expect(audit.reason).toContain("Irreversible loss");
  });

  test("describes fork bomb pattern", () => {
    const audit = getCriticalDangerAudit(":(){ :|:& };:");
    expect(audit.action).toContain("fork bomb");
    expect(audit.reason).toContain("denial of service");
  });

  test("describes mkfs pattern", () => {
    const audit = getCriticalDangerAudit("mkfs.ext4 /dev/sdb");
    expect(audit.action).toContain("Formats disk partition");
    expect(audit.reason).toContain("Critical destructive drive format");
  });

  test("describes dd if= pattern", () => {
    const audit = getCriticalDangerAudit("dd if=/dev/zero of=/dev/sda");
    expect(audit.action).toContain("raw byte copying or writing");
    expect(audit.reason).toContain("Potential low-level raw disk or partition overwrite");
  });

  test("describes raw device redirect pattern", () => {
    const audit = getCriticalDangerAudit("echo 0 > /dev/sda");
    expect(audit.action).toContain("storage device node");
    expect(audit.reason).toContain("Direct raw storage device overwrite detected");
  });

  test("returns fallback audit when command matches general critical danger", () => {
    const audit = getCriticalDangerAudit("unknown-danger");
    expect(audit.action).toBe("Executes high-risk destructive shell command");
    expect(audit.reason).toBe(
      "Critical destructive or irreversible infrastructure action detected.",
    );
  });
});

describe("GUARD_SYSTEM_PROMPT", () => {
  test("aligns with focused safe vs unsafe prompt structure", () => {
    expect(GUARD_SYSTEM_PROMPT).toContain("<identity>");
    expect(GUARD_SYSTEM_PROMPT).toContain("</identity>");
    expect(GUARD_SYSTEM_PROMPT).toContain("SAFE or UNSAFE to execute");
    expect(GUARD_SYSTEM_PROMPT).not.toContain("coding agent");
    expect(GUARD_SYSTEM_PROMPT).not.toContain("human confirmation");
    expect(GUARD_SYSTEM_PROMPT).toContain("<principles>");
    expect(GUARD_SYSTEM_PROMPT).toContain("</principles>");
    expect(GUARD_SYSTEM_PROMPT).toContain("<safe_categories>");
    expect(GUARD_SYSTEM_PROMPT).toContain("</safe_categories>");
    expect(GUARD_SYSTEM_PROMPT).toContain("<unsafe_categories>");
    expect(GUARD_SYSTEM_PROMPT).toContain("</unsafe_categories>");
    expect(GUARD_SYSTEM_PROMPT).toContain("<examples>");
    expect(GUARD_SYSTEM_PROMPT).toContain("</examples>");
    expect(GUARD_SYSTEM_PROMPT).toContain("<output_format>");
    expect(GUARD_SYSTEM_PROMPT).toContain(
      '{"safe": boolean, "action": "concise description of what the command does", "reason": "concise explanation of safety or risk"}',
    );
  });
});

describe("isDecisionModel", () => {
  test("identifies typesafe api models", () => {
    const model = { api: "typesafe", provider: "typesafe", id: "jev-latest" } as Model<Api>;
    expect(isDecisionModel(model)).toBe(true);
  });

  test("identifies openrouter-decisions api models", () => {
    const model = {
      api: "openrouter-decisions",
      provider: "openrouter",
      id: "~typesafe/jev-latest",
    } as Model<Api>;
    expect(isDecisionModel(model)).toBe(true);
  });

  test("identifies judge kind models", () => {
    const model = {
      api: "typesafe",
      provider: "typesafe",
      id: "jev-fast",
      kind: "judge",
    } as unknown as Model<Api>;
    expect(isDecisionModel(model)).toBe(true);
  });

  test("returns false for standard chat models", () => {
    const model = {
      api: "openai-responses",
      provider: "openai",
      id: "gpt-4o",
      kind: "chat",
    } as unknown as Model<Api>;
    expect(isDecisionModel(model)).toBe(false);
  });
});

describe("getConfiguredModelRole", () => {
  test("returns string or undefined safely without throwing", () => {
    const role = getConfiguredModelRole("nonexistent_role_xyz");
    expect(role === undefined || typeof role === "string").toBe(true);
  });
});

describe("parseSystemOneOutput", () => {
  test("returns safe verdict for high safety score and safe_local action", () => {
    const output = parseSystemOneOutput({
      answers: {
        safety: { type: "noul", noul: 0.95 },
        action: { type: "choice", choice: "safe_local" },
      },
    });
    expect(output.safe).toBe(true);
    expect(output.action).toBe("safe_local");
    expect(output.reason).toBe("Command verified safe by System One.");
  });

  test("returns unsafe verdict when safety score is below 0.85", () => {
    const output = parseSystemOneOutput({
      answers: {
        safety: { type: "noul", noul: 0.8 },
        action: { type: "choice", choice: "safe_local" },
      },
    });
    expect(output.safe).toBe(false);
    expect(output.action).toBe("safe_local");
    expect(output.reason).toContain("System One flagged as [safe_local] (safety: 80%).");
  });

  test("returns unsafe verdict when action is not safe_local", () => {
    const output = parseSystemOneOutput({
      answers: {
        safety: { type: "noul", noul: 0.95 },
        action: { type: "choice", choice: "cloud_or_remote" },
      },
    });
    expect(output.safe).toBe(false);
    expect(output.action).toBe("cloud_or_remote");
    expect(output.reason).toContain("System One flagged as [cloud_or_remote]");
  });

  test("throws when input data is not an object", () => {
    expect(() => parseSystemOneOutput(null)).toThrow("Invalid response format");
    expect(() => parseSystemOneOutput("string")).toThrow("Invalid response format");
  });

  test("throws when safety score is missing or invalid", () => {
    expect(() => parseSystemOneOutput({ answers: {} })).toThrow("Missing safety probability");
    expect(() =>
      parseSystemOneOutput({ answers: { safety: { type: "noul", noul: Number.NaN } } }),
    ).toThrow("Missing safety probability");
  });
});
describe("parseSystemOneOutput P1/P2/P3 risk hierarchy", () => {
  test("returns unsafe verdict when P1 prod risk is above 0.05", () => {
    const output = parseSystemOneOutput({
      answers: {
        p1_prod_impact: { type: "noul", noul: 0.12 },
        p2_malicious: { type: "noul", noul: 0.0 },
        p3_local_impact: { type: "choice", choice: "safe_local" },
      },
    });
    expect(output.safe).toBe(false);
    expect(output.action).toBe("production_mutation");
    expect(output.reason).toContain("Priority 1 alert");
  });

  test("returns unsafe verdict when P2 malicious risk is above 0.10", () => {
    const output = parseSystemOneOutput({
      answers: {
        p1_prod_impact: { type: "noul", noul: 0.0 },
        p2_malicious: { type: "noul", noul: 0.25 },
        p3_local_impact: { type: "choice", choice: "safe_local" },
      },
    });
    expect(output.safe).toBe(false);
    expect(output.action).toBe("security_violation");
    expect(output.reason).toContain("Priority 2 alert");
  });

  test("returns unsafe verdict when P3 local impact is destructive_wipe", () => {
    const output = parseSystemOneOutput({
      answers: {
        p1_prod_impact: { type: "noul", noul: 0.0 },
        p2_malicious: { type: "noul", noul: 0.0 },
        p3_local_impact: { type: "choice", choice: "destructive_wipe" },
      },
    });
    expect(output.safe).toBe(false);
    expect(output.action).toBe("destructive_wipe");
    expect(output.reason).toContain("Priority 3 alert");
  });

  test("returns safe verdict when P1 and P2 are safe and P3 is safe_local or cache_cleanup", () => {
    const output1 = parseSystemOneOutput({
      answers: {
        p1_prod_impact: { type: "noul", noul: 0.01 },
        p2_malicious: { type: "noul", noul: 0.02 },
        p3_local_impact: { type: "choice", choice: "safe_local" },
      },
    });
    expect(output1.safe).toBe(true);
    expect(output1.action).toBe("safe_local");

    const output2 = parseSystemOneOutput({
      answers: {
        p1_prod_impact: { type: "noul", noul: 0.0 },
        p2_malicious: { type: "noul", noul: 0.0 },
        p3_local_impact: { type: "choice", choice: "cache_cleanup" },
      },
    });
    expect(output2.safe).toBe(true);
    expect(output2.action).toBe("cache_cleanup");
  });
  test("throws when P1 risk probability is missing or invalid in 3-tier response", () => {
    expect(() =>
      parseSystemOneOutput({
        answers: {
          p2_malicious: { type: "noul", noul: 0.0 },
          p3_local_impact: { type: "choice", choice: "safe_local" },
        },
      }),
    ).toThrow("Missing or invalid P1/P2 risk probability");

    expect(() =>
      parseSystemOneOutput({
        answers: {
          p1_prod_impact: { type: "noul", noul: Number.NaN },
          p2_malicious: { type: "noul", noul: 0.0 },
          p3_local_impact: { type: "choice", choice: "safe_local" },
        },
      }),
    ).toThrow("Missing or invalid P1/P2 risk probability");
  });

  test("throws when P2 risk probability is missing or invalid in 3-tier response", () => {
    expect(() =>
      parseSystemOneOutput({
        answers: {
          p1_prod_impact: { type: "noul", noul: 0.0 },
          p3_local_impact: { type: "choice", choice: "safe_local" },
        },
      }),
    ).toThrow("Missing or invalid P1/P2 risk probability");
  });
});

describe("config utilities", () => {
  test("resolveProductionMarkers merges defaults and custom markers", () => {
    const markers = resolveProductionMarkers({
      production: {
        namespaces: ["prd*", "prod-us"],
        projects: ["my-prod-project"],
        clusters: ["k8s-prod"],
        markers: ["live-cluster"],
      },
    });
    expect(markers).toContain("prod");
    expect(markers).toContain("prd");
    expect(markers).toContain("prod-us");
    expect(markers).toContain("my-prod-project");
    expect(markers).toContain("k8s-prod");
    expect(markers).toContain("live-cluster");
  });

  test("isAllowlistedCommand matches regex patterns", () => {
    const config = {
      allowlist: ["^git (status|diff)$", "cargo check"],
    };
    expect(isAllowlistedCommand("git status", config)).toBe(true);
    expect(isAllowlistedCommand("git diff", config)).toBe(true);
    expect(isAllowlistedCommand("cargo check", config)).toBe(true);
    expect(isAllowlistedCommand("git push origin main", config)).toBe(false);
    expect(isAllowlistedCommand("rm -rf /", config)).toBe(false);
  });

  test("isAllowlistedCommand handles empty allowlist safely", () => {
    expect(isAllowlistedCommand("git status", {})).toBe(false);
    expect(isAllowlistedCommand("git status", { allowlist: [] })).toBe(false);
    expect(isAllowlistedCommand("git status", { allowlist: ["invalid[regex"] })).toBe(false);
  });
  test("resolveProductionMarkers handles scalar strings and non-string array entries safely", () => {
    const markers = resolveProductionMarkers({
      production: {
        markers: "prod" as unknown as string[],
        namespaces: [12345, null, undefined, "custom-ns"] as unknown as string[],
      },
    });
    expect(markers).toContain("prod");
    expect(markers).toContain("custom-ns");
  });

  test("isAllowlistedCommand rejects string allowlist safely without space matching", () => {
    const config = { allowlist: "git status" as unknown as string[] };
    expect(isAllowlistedCommand("rm -rf /", config)).toBe(false);
    expect(isAllowlistedCommand("git status", config)).toBe(false);
  });

  test("isAllowlistedCommand ignores empty string and whitespace-only patterns", () => {
    expect(isAllowlistedCommand("rm -rf /", { allowlist: ["", "   "] })).toBe(false);
    expect(isAllowlistedCommand("git status", { allowlist: ["^git status$", ""] })).toBe(true);
  });

  test("loadGuardConfig returns empty object when file not found", () => {
    const config = loadGuardConfig("/tmp/nonexistent-guard-dir-xyz");
    expect(config).toEqual({});
  });
});

describe("evaluateSystemOneSafety", () => {
  test("queries typesafe default endpoint with apiKey and parses output", async () => {
    let requestUrl: string | undefined;
    let requestInit: RequestInit | undefined;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({
          answers: {
            safety: { type: "noul", noul: 0.99 },
            action: { type: "choice", choice: "safe_local" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const model = { api: "typesafe", provider: "typesafe", id: "jev-latest" } as Model<Api>;
    const controller = new AbortController();
    const verdict = await evaluateSystemOneSafety(
      model,
      "ts-test-key",
      "cargo test",
      controller.signal,
      mockFetch as unknown as typeof fetch,
    );

    expect(requestUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(requestInit?.method).toBe("POST");
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ts-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(verdict.safe).toBe(true);
    expect(verdict.reason).toBe("Command verified safe by System One.");
  });

  test("queries openrouter decisions route for openrouter-decisions api", async () => {
    let requestUrl: string | undefined;
    const mockFetch = async (input: RequestInfo | URL) => {
      requestUrl = String(input);
      return new Response(
        JSON.stringify({
          answers: {
            safety: { type: "noul", noul: 0.99 },
            action: { type: "choice", choice: "safe_local" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const model = {
      api: "openrouter-decisions",
      provider: "openrouter",
      id: "~typesafe/jev-latest",
    } as Model<Api>;
    const controller = new AbortController();
    await evaluateSystemOneSafety(
      model,
      "or-key",
      "cargo test",
      controller.signal,
      mockFetch as unknown as typeof fetch,
    );

    expect(requestUrl).toBe("https://openrouter.ai/api/alpha/decisions");
  });

  test("throws when System One API returns non-200 status", async () => {
    const mockFetch = async () => new Response("Unauthorized", { status: 401 });
    const model = { api: "typesafe", provider: "typesafe", id: "jev-latest" } as Model<Api>;
    const controller = new AbortController();

    expect(
      evaluateSystemOneSafety(
        model,
        undefined,
        "cargo test",
        controller.signal,
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow("System One API 401: Unauthorized");
  });
});

describe("evaluateCommandSafety with decision models", () => {
  test("evaluates command safety via System One route and returns verdict", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          answers: {
            safety: { type: "noul", noul: 0.95 },
            action: { type: "choice", choice: "safe_local" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const model = { api: "typesafe", provider: "typesafe", id: "jev-latest" } as Model<Api>;
    const verdict = await evaluateCommandSafety(
      model,
      "key",
      "git status",
      mockFetch as unknown as typeof fetch,
    );
    expect(verdict.safe).toBe(true);
  });

  test("handles System One failure safely", async () => {
    const mockFetch = async () => new Response("Internal Server Error", { status: 500 });
    const model = { api: "typesafe", provider: "typesafe", id: "jev-latest" } as Model<Api>;
    const verdict = await evaluateCommandSafety(
      model,
      "key",
      "git status",
      mockFetch as unknown as typeof fetch,
    );
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toContain("Guard model check failed");
  });
});

describe("registerBashGuard integration with decision models", () => {
  test("allows execution when decision model confirms command safe", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          answers: {
            safety: { type: "noul", noul: 0.95 },
            action: { type: "choice", choice: "safe_local" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const decisionModel = {
        api: "typesafe",
        provider: "typesafe",
        id: "jev-latest",
      } as Model<Api>;

      const result = await toolCallHandler!(
        { toolName: "bash", input: { command: "cargo check" } },
        {
          hasUI: true,
          models: {
            resolve: () => decisionModel,
          },
          modelRegistry: {
            getApiKey: async () => "ts-key",
          },
        },
      );

      expect(result).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("prompts user when decision model flags command as unsafe", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          answers: {
            safety: { type: "noul", noul: 0.4 },
            action: { type: "choice", choice: "cloud_or_remote" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const decisionModel = {
        api: "typesafe",
        provider: "typesafe",
        id: "jev-latest",
      } as Model<Api>;

      let promptedReason: string | undefined;
      const mockAskDialog = async (questions: unknown) => {
        const qs = questions as Array<{ question: string }>;
        promptedReason = qs[0]?.question;
        return {
          kind: "submit",
          results: [{ selectedOptions: ["Cancel"] }],
        };
      };

      const result = await toolCallHandler!(
        { toolName: "bash", input: { command: "git push origin main" } },
        {
          hasUI: true,
          ui: {
            askDialog: mockAskDialog,
          },
          models: {
            resolve: () => decisionModel,
          },
          modelRegistry: {
            getApiKey: async () => "ts-key",
          },
        },
      );

      expect(promptedReason).toContain("System One flagged as [cloud_or_remote]");
      expect(result).toEqual({
        block: true,
        reason:
          "User denied execution: System One flagged as [cloud_or_remote] (safety: 40%). (Action: cloud_or_remote)",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("registerBashGuard eval tool interception", () => {
  test("allows safe eval script execution", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mock = createMockModel({
      responses: [
        {
          content: [{ type: "text", text: '{"safe": true, "reason": "Pure computational logic"}' }],
        },
      ],
    });

    const result = await toolCallHandler!(
      { toolName: "eval", input: { language: "js", code: "const x = 1 + 1;" } },
      {
        hasUI: true,
        models: {
          resolve: () => mock as unknown as Model<Api>,
        },
      },
    );

    expect(result).toBeUndefined();
  });

  test("blocks critical danger inside eval code", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mockAskDialog = async () => ({
      kind: "submit",
      results: [{ selectedOptions: ["Cancel"] }],
    });

    const result = await toolCallHandler!(
      { toolName: "eval", input: { language: "js", code: "await $`rm -rf /`" } },
      {
        hasUI: true,
        ui: {
          askDialog: mockAskDialog,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "User denied execution: Critical destructive filesystem wipe detected. (Action: Recursively deletes root, home, parent, or wildcard files)",
    });
  });

  test("blocks unsafe eval script in headless mode", async () => {
    let toolCallHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);

    const mock = createMockModel({
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": false, "reason": "Executes shell commands to access cloud keys."}',
            },
          ],
        },
      ],
    });

    const result = await toolCallHandler!(
      {
        toolName: "eval",
        input: { language: "py", code: "import os; os.system('cat ~/.aws/credentials')" },
      },
      {
        hasUI: false,
        models: {
          resolve: () => mock as unknown as Model<Api>,
        },
      },
    );

    expect(result).toEqual({
      block: true,
      reason:
        "[Eval Guard] Blocked unsafe script (headless mode): Executes shell commands to access cloud keys.",
    });
  });

  test("ignores eval tool calls with missing or empty code", async () => {
    let toolCallHandler: ((event: unknown, ctx?: unknown) => Promise<unknown>) | undefined;
    const mockPi = {
      on: (_event: string, handler: (event: unknown, ctx?: unknown) => Promise<unknown>) => {
        toolCallHandler = handler;
      },
    };

    registerBashGuard(mockPi as unknown as Parameters<typeof registerBashGuard>[0]);
    expect(await toolCallHandler!({ toolName: "eval", input: { code: "" } })).toBeUndefined();
    expect(await toolCallHandler!({ toolName: "eval", input: {} })).toBeUndefined();
  });
});
