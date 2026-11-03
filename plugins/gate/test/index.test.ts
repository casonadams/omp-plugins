import * as os from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import registerGate, { ENV_DISABLE } from "../index";
import type { GateContext, PiExtensionAPI } from "../src/types";
import { fakeExec, NOT_FOUND, type Handler } from "./helpers";

type AnyHandler = (event: unknown, ctx: GateContext) => Promise<unknown>;

function load(handler: Handler) {
  const { exec } = fakeExec(handler);
  const handlers: Record<string, AnyHandler> = {};
  const pi = {
    exec,
    on: (e: string, h: unknown) => (handlers[e] = h as AnyHandler),
  } as PiExtensionAPI;
  registerGate(pi);
  return handlers;
}

let tree = "t1";
const repo =
  (qualityCode: number): Handler =>
  (cmd, args) => {
    if (cmd === "ripwire-rs")
      return args.includes("--quality-delta")
        ? { code: qualityCode, stdout: '<r gating="1"/>' }
        : undefined;
    if (cmd !== "git" && cmd !== "test") return NOT_FOUND;
    if (args.includes("--show-toplevel")) return { stdout: "/r\n" };
    if (args.includes("--name-only")) return { stdout: "a.rs\n" };
    if (args[0] === "diff" && !args.includes("-U0")) return { stdout: tree };
    return undefined;
  };
const ctx: GateContext = { cwd: "/r", hasUI: false };
const commit = { toolName: "bash", input: { command: "git commit -m x" } };

afterEach(() => {
  delete process.env[ENV_DISABLE];
  tree = "t1";
});

describe("registerGate", () => {
  test("registers nothing when disabled by the environment", () => {
    process.env[ENV_DISABLE] = "1";
    expect(Object.keys(load(repo(0)))).toEqual([]);
  });

  test("blocks a commit while the gate fails and lets other commands through", async () => {
    const h = load(repo(2));
    await h.session_start({}, ctx);
    const blocked = (await h.tool_call(commit, ctx)) as { block: boolean; reason: string };
    expect(blocked.block).toBe(true);
    expect(blocked.reason).toContain("gate: BLOCKED");
    expect(
      await h.tool_call({ toolName: "bash", input: { command: "git status" } }, ctx),
    ).toBeUndefined();
    expect(
      await h.tool_call({ toolName: "read", input: { command: "git commit" } }, ctx),
    ).toBeUndefined();
  });

  test("a passing gate adds its output to the context, then the turn owes one Gate block, once", async () => {
    const h = load(repo(0));
    await h.session_start({}, ctx);
    tree = "t2";
    const passed = (await h.tool_call(commit, ctx)) as { additionalContext: string };
    expect(passed.additionalContext).toContain("gate: PASS");
    const reply = (text: string) => ({ last_assistant_message: { content: text } });
    expect(await h.session_stop(reply("done"), ctx)).toMatchObject({ continue: true });
    expect(await h.session_stop(reply("done"), ctx)).toBeUndefined();
    expect(await h.session_stop(reply("done\nGate: exit 0"), ctx)).toBeUndefined();
    tree = "t3";
    expect(await h.session_stop(reply("Gate: exit 0"), ctx)).toBeUndefined();
  });

  test("the gate runs once per working-tree state, however often it is asked", async () => {
    let runs = 0;
    const base = repo(0);
    const h = load((cmd, args) => {
      if (cmd === "ripwire-rs" && args.includes("--quality-delta")) runs++;
      return base(cmd, args);
    });
    await h.session_start({}, ctx);
    tree = "t2";
    for (let i = 0; i < 3; i++) await h.tool_call(commit, ctx);
    await h.session_stop({ last_assistant_message: { content: "Gate: ok" } }, ctx);
    expect(runs).toBe(1);
    tree = "t3";
    await h.tool_call(commit, ctx);
    expect(runs).toBe(2);
  });

  test("a failing gate asks once at stop, then lets the turn end", async () => {
    const h = load(repo(2));
    await h.session_start({}, ctx);
    tree = "t2";
    const first = (await h.session_stop({ last_assistant_message: { content: "done" } }, ctx)) as {
      additionalContext: string;
    };
    expect(first.additionalContext).toContain("gate does not pass");
    expect(
      await h.session_stop({ last_assistant_message: { content: "done" } }, ctx),
    ).toBeUndefined();
  });

  test("announces itself in an interactive session", async () => {
    const messages: string[] = [];
    const h = load(repo(0));
    await h.session_start(
      {},
      { cwd: "/r", hasUI: true, ui: { notify: (m) => void messages.push(m) } },
    );
    expect(messages[0]).toContain("gate active");
  });

  test("gates the repository a command changes into, not the session directory", async () => {
    const { exec, cwds } = fakeExec(repo(0));
    const handlers: Record<string, AnyHandler> = {};
    registerGate({
      exec,
      on: (e: string, h: unknown) => (handlers[e] = h as AnyHandler),
    } as PiExtensionAPI);
    await handlers.session_start({}, ctx);
    cwds.length = 0;
    const other = os.tmpdir();
    const command = `cd ${other} && git commit -m x`;
    await handlers.tool_call({ toolName: "bash", input: { command } }, ctx);
    expect(cwds.length).toBeGreaterThan(0);
    expect(cwds).toContain(other);
    expect(cwds).not.toContain("");
  });

  test("a gate that throws is reported, not raised, and does not block the commit", async () => {
    const handlers: Record<string, AnyHandler> = {};
    const exec = async () => {
      throw new Error("spawn failed");
    };
    registerGate({
      exec,
      on: (e: string, h: unknown) => (handlers[e] = h as AnyHandler),
    } as unknown as PiExtensionAPI);
    const result = (await handlers.tool_call(commit, ctx)) as {
      block?: boolean;
      additionalContext: string;
    };
    expect(result.block).toBeUndefined();
    expect(result.additionalContext).toContain("could not run");
    expect(result.additionalContext).toContain("spawn failed");
  });
});
