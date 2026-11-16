import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import registerRefine, { type RefineAPI, type RefineContext } from "../index";

type Handler = Parameters<RefineAPI["registerCommand"]>[1]["handler"];

function load() {
  const sent: { message: { content: string; customType: string }; triggerTurn: boolean }[] = [];
  let handler: Handler | undefined;
  registerRefine({
    registerCommand: (_name, options) => (handler = options.handler),
    sendMessage: (message, options) => sent.push({ message, triggerTurn: options.triggerTurn }),
  });
  return { sent, run: (args: string, ctx: RefineContext) => handler!(args, ctx) };
}

function context(cwd: string, idle: boolean | boolean[] = true) {
  const notes: { message: string; type?: string }[] = [];
  const ctx: RefineContext = {
    cwd,
    isIdle: () => (Array.isArray(idle) ? idle.shift()! : idle),
    ui: { notify: (message, type) => notes.push({ message, type }) },
  };
  return { ctx, notes };
}

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("/refine", () => {
  test("scan sends the profile prompt and starts a turn", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "refine-"));
    await writeFile(path.join(dir, "a.ts"), "");
    const { sent, run } = load();
    const { ctx, notes } = context(dir);

    await run("security", ctx);

    expect(sent).toHaveLength(1);
    expect(sent[0].triggerTurn).toBe(true);
    expect(sent[0].message.customType).toBe("refine-scan");
    expect(sent[0].message.content).toContain("Profile: security");
    expect(notes[0].message).toBe("refine security standard scan started");
  });

  test("a busy agent refuses the scan without sending", async () => {
    const { sent, run } = load();
    const { ctx, notes } = context("/nowhere", false);

    await run("review", ctx);

    expect(sent).toEqual([]);
    expect(notes).toEqual([{ message: "Agent is busy. Run /refine when idle.", type: "warning" }]);
  });

  test("an agent that turns busy during inventory is not sent a scan", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "refine-"));
    const { sent, run } = load();
    const { ctx, notes } = context(dir, [true, false]);

    await run("review", ctx);

    expect(sent).toEqual([]);
    expect(notes).toEqual([
      {
        message: "Agent became busy during inventory. Run /refine again when idle.",
        type: "warning",
      },
    ]);
  });

  test("bad arguments report the error with usage and send nothing", async () => {
    const { sent, run } = load();
    const { ctx, notes } = context("/nowhere");

    await run("nope", ctx);

    expect(sent).toEqual([]);
    expect(notes[0].type).toBe("error");
    expect(notes[0].message).toContain("Unknown profile: nope");
    expect(notes[0].message).toContain("Usage: /refine <profile>");
  });

  test("help prints usage", async () => {
    const { sent, run } = load();
    const { ctx, notes } = context("/nowhere");

    await run("", ctx);

    expect(sent).toEqual([]);
    expect(notes[0]).toMatchObject({ type: "info" });
  });
});
