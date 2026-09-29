import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import registerHistory, { registerShellHistory } from "../index";
import type { PiExtensionAPI, ToolResultEvent } from "../src/types";

describe("registerHistory extension hook", () => {
  let tmpDir: string;
  let historyFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "history-int-"));
    historyFile = path.join(tmpDir, ".zsh_history");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createMockPi(): {
    pi: PiExtensionAPI;
    emit(event: ToolResultEvent): Promise<void>;
  } {
    const handlers: Array<(event: ToolResultEvent) => Promise<void> | void> = [];
    const pi: PiExtensionAPI = {
      on(eventName: string, handler: (event: ToolResultEvent) => Promise<void> | void) {
        if (eventName === "tool_result") {
          handlers.push(handler);
        }
      },
    };
    return {
      pi,
      async emit(event: ToolResultEvent) {
        for (const handler of handlers) {
          await handler(event);
        }
      },
    };
  }

  test("syncs successful bash tool command to history file", async () => {
    const { pi, emit } = createMockPi();
    registerHistory(pi, { historyFile, shell: "zsh", extendedHistory: true });

    await emit({
      toolName: "bash",
      input: { command: "git status" },
      isError: false,
    });

    const content = await fs.readFile(historyFile, "utf8");
    expect(content).toMatch(/^: \d+:0;git status\n$/);
  });

  test("does not sync when isError is true", async () => {
    const { pi, emit } = createMockPi();
    registerHistory(pi, { historyFile, shell: "zsh" });

    await emit({
      toolName: "bash",
      input: { command: "exit 1" },
      isError: true,
    });

    const exists = await fs
      .access(historyFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test("ignores non-bash tools", async () => {
    const { pi, emit } = createMockPi();
    registerHistory(pi, { historyFile, shell: "zsh" });

    await emit({
      toolName: "write",
      input: { command: "echo should-not-run" },
    });
    await emit({
      toolName: "read",
      input: { command: "echo should-not-run" },
    });

    const exists = await fs
      .access(historyFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test("ignores missing or non-string command input safely", async () => {
    const { pi, emit } = createMockPi();
    registerHistory(pi, { historyFile, shell: "zsh" });

    await emit({ toolName: "bash", input: {} });
    await emit({ toolName: "bash", input: { command: 12345 } });
    await emit({ toolName: "bash" });

    const exists = await fs
      .access(historyFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  test("ignores leading space commands and consecutive duplicates", async () => {
    const { pi, emit } = createMockPi();
    registerHistory(pi, { historyFile, shell: "bash", extendedHistory: false });

    // Leading space command should be ignored
    await emit({
      toolName: "bash",
      input: { command: " export SECRET=1" },
    });

    // Valid command
    await emit({
      toolName: "bash",
      input: { command: "echo first" },
    });

    // Consecutive duplicate
    await emit({
      toolName: "bash",
      input: { command: "echo first" },
    });

    // New command
    await emit({
      toolName: "bash",
      input: { command: "echo second" },
    });

    const content = await fs.readFile(historyFile, "utf8");
    expect(content).toBe("echo first\necho second\n");
  });

  test("registerShellHistory alias works identically to registerHistory", async () => {
    const { pi, emit } = createMockPi();
    registerShellHistory(pi, { historyFile, shell: "bash" });

    await emit({
      toolName: "bash",
      input: { command: "whoami" },
    });

    const content = await fs.readFile(historyFile, "utf8");
    expect(content).toBe("whoami\n");
  });
});
