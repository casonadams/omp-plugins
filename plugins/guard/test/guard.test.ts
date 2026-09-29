import type { Api, Model } from "@oh-my-pi/pi-ai";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";
import { describe, expect, test } from "bun:test";
import registerBashGuard, {
  CRITICAL_DANGER_REGEX,
  GUARD_SYSTEM_PROMPT,
  evaluateCommandSafety,
  getCriticalDangerAudit,
  parseGuardOutput,
  promptUser,
  resolveGuardModel,
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
    expect(questions[0]?.question).toContain("Allow execution?");
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
