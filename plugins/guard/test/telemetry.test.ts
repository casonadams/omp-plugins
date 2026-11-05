import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import registerBashGuard, {
  createDecisionRecord,
  isTelemetryEnabled,
  logGuardDecision,
  resolveTelemetryPath,
  TARGET_LABELS,
  type ExtensionContext,
  type JevDecisionRecord,
  type PiExtensionAPI,
  type ToolCallEvent,
} from "../index";

describe("telemetry helpers", () => {
  test("TARGET_LABELS maps keys correctly", () => {
    expect(TARGET_LABELS.safe_auto_allow).toBe("A");
    expect(TARGET_LABELS.ask_confirmation).toBe("B");
    expect(TARGET_LABELS.hard_deny).toBe("C");
  });

  test("createDecisionRecord populates all fields with defaults", () => {
    const record = createDecisionRecord({
      command: "git worktree rm /tmp/test-wt",
      cwd: "/home/me/dev/terrarium",
      targetKey: "safe_auto_allow",
      source: "user_proceed",
      latencyMs: 142.6,
    });

    expect(record.state.command).toBe("git worktree rm /tmp/test-wt");
    expect(record.state.language).toBe("bash");
    expect(record.state.cwd).toBe("/home/me/dev/terrarium");
    expect(record.question).toBe("Classify the safety policy for this tool execution.");
    expect(record.options).toHaveLength(3);
    expect(record.target.label).toBe("A");
    expect(record.target.key).toBe("safe_auto_allow");
    expect(record.target.source).toBe("user_proceed");
    expect(record.target.feedback).toBeNull();
    expect(record.target.latency_ms).toBe(143);
    expect(typeof record.id).toBe("string");
    expect(typeof record.timestamp).toBe("string");
  });

  test("createDecisionRecord includes model_verdict and feedback when supplied", () => {
    const record = createDecisionRecord({
      command: "rm -rf /",
      targetKey: "hard_deny",
      source: "user_feedback",
      feedback: "never delete root directory",
      latencyMs: 50,
      modelVerdict: {
        model: "typesafe/jev-latest",
        safe: false,
        action: "delete_root",
        reason: "Dangerous root deletion",
        raw: { p1: 0.99 },
      },
    });

    expect(record.target.label).toBe("C");
    expect(record.target.key).toBe("hard_deny");
    expect(record.target.source).toBe("user_feedback");
    expect(record.target.feedback).toBe("never delete root directory");
    expect(record.model_verdict).toEqual({
      model: "typesafe/jev-latest",
      safe: false,
      action: "delete_root",
      reason: "Dangerous root deletion",
      raw: { p1: 0.99 },
    });
  });

  test("resolveTelemetryPath respects config, env var, and default", () => {
    const defaultPath = resolveTelemetryPath(undefined, "/custom/home");
    expect(defaultPath).toBe("/custom/home/.omp/guard/decisions.jsonl");

    const configured = resolveTelemetryPath({ telemetry: { path: "/tmp/custom.jsonl" } }, "/custom/home");
    expect(configured).toBe("/tmp/custom.jsonl");

    const originalEnv = process.env.GUARD_TELEMETRY_PATH;
    try {
      process.env.GUARD_TELEMETRY_PATH = "/env/override.jsonl";
      expect(resolveTelemetryPath({ telemetry: { path: "/tmp/custom.jsonl" } })).toBe("/env/override.jsonl");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GUARD_TELEMETRY_PATH;
      } else {
        process.env.GUARD_TELEMETRY_PATH = originalEnv;
      }
    }
  });

  test("isTelemetryEnabled respects config and env var", () => {
    expect(isTelemetryEnabled({})).toBe(true);
    expect(isTelemetryEnabled({ telemetry: { enabled: false } })).toBe(false);

    const originalEnv = process.env.GUARD_TELEMETRY_DISABLED;
    try {
      process.env.GUARD_TELEMETRY_DISABLED = "1";
      expect(isTelemetryEnabled({})).toBe(false);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.GUARD_TELEMETRY_DISABLED;
      } else {
        process.env.GUARD_TELEMETRY_DISABLED = originalEnv;
      }
    }
  });
});

describe("telemetry file persistence", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-telemetry-test-"));
    testFilePath = path.join(tempDir, "sub", "decisions.jsonl");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("logGuardDecision creates directory and appends JSONL lines safely", () => {
    const record1 = createDecisionRecord({
      command: "git status",
      targetKey: "safe_auto_allow",
      source: "allowlist",
      latencyMs: 1,
    });
    const record2 = createDecisionRecord({
      command: "git worktree rm /tmp/wt",
      targetKey: "safe_auto_allow",
      source: "user_proceed",
      latencyMs: 500,
    });

    logGuardDecision(record1, testFilePath);
    logGuardDecision(record2, testFilePath);

    const content = fs.readFileSync(testFilePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]) as JevDecisionRecord;
    const parsed2 = JSON.parse(lines[1]) as JevDecisionRecord;

    expect(parsed1.state.command).toBe("git status");
    expect(parsed1.target.source).toBe("allowlist");
    expect(parsed2.state.command).toBe("git worktree rm /tmp/wt");
    expect(parsed2.target.source).toBe("user_proceed");
  });

  test("logGuardDecision suppresses write errors without throwing", () => {
    const record = createDecisionRecord({
      command: "ls",
      targetKey: "safe_auto_allow",
      source: "model_safe",
      latencyMs: 10,
    });
    // Write to a path that cannot be created (directory that is a file)
    const badPath = path.join(tempDir, "file-blocker", "decisions.jsonl");
    fs.writeFileSync(path.join(tempDir, "file-blocker"), "blocker");

    expect(() => logGuardDecision(record, badPath)).not.toThrow();
  });
});

describe("registerBashGuard telemetry integration", () => {
  let tempDir: string;
  let telemetryFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-integ-test-"));
    telemetryFile = path.join(tempDir, "decisions.jsonl");
    originalEnv = process.env.GUARD_TELEMETRY_PATH;
    process.env.GUARD_TELEMETRY_PATH = telemetryFile;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GUARD_TELEMETRY_PATH;
    } else {
      process.env.GUARD_TELEMETRY_PATH = originalEnv;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  });

  function readTelemetryRecords(): JevDecisionRecord[] {
    if (!fs.existsSync(telemetryFile)) return [];
    const content = fs.readFileSync(telemetryFile, "utf8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line));
  }

  test("logs allowlisted execution as safe_auto_allow with allowlist source", async () => {
    let handler: ((event: ToolCallEvent, ctx?: ExtensionContext) => Promise<unknown>) | undefined;
    const mockPi: PiExtensionAPI = {
      on: (_evt, h) => {
        handler = h;
      },
    };

    registerBashGuard(mockPi);

    // Create .guard.yml in tempDir allowlisting git status
    fs.writeFileSync(path.join(tempDir, ".guard.yml"), "allowlist:\n  - '^git status$'\n");

    const ctx: ExtensionContext = { cwd: tempDir };
    const res = await handler!({ toolName: "bash", input: { command: "git status" } }, ctx);

    expect(res).toBeUndefined();

    const records = readTelemetryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].state.command).toBe("git status");
    expect(records[0].target.key).toBe("safe_auto_allow");
    expect(records[0].target.source).toBe("allowlist");
  });

  test("logs model unsafe + user proceed as safe_auto_allow with user_proceed source", async () => {
    let handler: ((event: ToolCallEvent, ctx?: ExtensionContext) => Promise<unknown>) | undefined;
    const mockPi: PiExtensionAPI = {
      on: (_evt, h) => {
        handler = h;
      },
    };

    registerBashGuard(mockPi);

    const mockModel = createMockModel({
      id: "mock-judge",
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": false, "action": "Removes temporary worktree", "reason": "Worktree removal in temp dir"}',
            },
          ],
        },
      ],
    });

    const ctx: ExtensionContext = {
      cwd: tempDir,
      hasUI: true,
      ui: {
        askDialog: async () => ({
          kind: "submit",
          results: [{ selectedOptions: ["Proceed"] }],
        }),
      },
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
    };

    const res = await handler!(
      { toolName: "bash", input: { command: "git worktree rm /tmp/test-wt" } },
      ctx,
    );

    expect(res).toBeUndefined(); // Allowed to proceed

    const records = readTelemetryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].state.command).toBe("git worktree rm /tmp/test-wt");
    expect(records[0].model_verdict?.safe).toBe(false);
    expect(records[0].model_verdict?.action).toBe("Removes temporary worktree");
    expect(records[0].target.key).toBe("safe_auto_allow");
    expect(records[0].target.source).toBe("user_proceed");
  });

  test("logs model unsafe + user cancel as ask_confirmation with user_cancel source", async () => {
    let handler: ((event: ToolCallEvent, ctx?: ExtensionContext) => Promise<unknown>) | undefined;
    const mockPi: PiExtensionAPI = {
      on: (_evt, h) => {
        handler = h;
      },
    };

    registerBashGuard(mockPi);

    const mockModel = createMockModel({
      id: "mock-judge",
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

    const ctx: ExtensionContext = {
      cwd: tempDir,
      hasUI: true,
      ui: {
        askDialog: async () => ({
          kind: "submit",
          results: [{ selectedOptions: ["Cancel"] }],
        }),
      },
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
    };

    const res = await handler!(
      { toolName: "bash", input: { command: "kubectl delete pod prod-api" } },
      ctx,
    );

    expect(res).toEqual({
      block: true,
      reason:
        "User denied execution: Mutates production environment (Action: Deletes production pod)",
    });

    const records = readTelemetryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].target.key).toBe("ask_confirmation");
    expect(records[0].target.source).toBe("user_cancel");
  });

  test("logs user feedback on denial as hard_deny with user_feedback source and feedback string", async () => {
    let handler: ((event: ToolCallEvent, ctx?: ExtensionContext) => Promise<unknown>) | undefined;
    const mockPi: PiExtensionAPI = {
      on: (_evt, h) => {
        handler = h;
      },
    };

    registerBashGuard(mockPi);

    const mockModel = createMockModel({
      id: "mock-judge",
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": false, "action": "Modifies infra", "reason": "Direct terraform mutation"}',
            },
          ],
        },
      ],
    });

    const ctx: ExtensionContext = {
      cwd: tempDir,
      hasUI: true,
      ui: {
        askDialog: async () => ({
          kind: "submit",
          results: [
            {
              selectedOptions: ["Cancel"],
              customInput: "Do not run terraform apply directly from agent context",
            },
          ],
        }),
      },
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
    };

    const res = await handler!(
      { toolName: "bash", input: { command: "terraform apply -auto-approve" } },
      ctx,
    );

    expect(res).toEqual({
      block: true,
      reason:
        "User denied execution with feedback: Do not run terraform apply directly from agent context",
    });

    const records = readTelemetryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].target.key).toBe("hard_deny");
    expect(records[0].target.source).toBe("user_feedback");
    expect(records[0].target.feedback).toBe(
      "Do not run terraform apply directly from agent context",
    );
  });

  test("logs model safe execution as safe_auto_allow with model_safe source", async () => {
    let handler: ((event: ToolCallEvent, ctx?: ExtensionContext) => Promise<unknown>) | undefined;
    const mockPi: PiExtensionAPI = {
      on: (_evt, h) => {
        handler = h;
      },
    };

    registerBashGuard(mockPi);

    const mockModel = createMockModel({
      id: "mock-judge",
      responses: [
        {
          content: [
            {
              type: "text",
              text: '{"safe": true, "reason": "Clean local inspection command"}',
            },
          ],
        },
      ],
    });

    const ctx: ExtensionContext = {
      cwd: tempDir,
      models: {
        resolve: () => mockModel as unknown as Model<Api>,
      },
    };

    const res = await handler!(
      { toolName: "bash", input: { command: "cargo clippy --workspace" } },
      ctx,
    );

    expect(res).toBeUndefined();

    const records = readTelemetryRecords();
    expect(records).toHaveLength(1);
    expect(records[0].state.command).toBe("cargo clippy --workspace");
    expect(records[0].model_verdict?.safe).toBe(true);
    expect(records[0].target.key).toBe("safe_auto_allow");
    expect(records[0].target.source).toBe("model_safe");
  });
});
