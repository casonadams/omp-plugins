import { describe, expect, test } from "bun:test";
import { fingerprint, NEEDS_FIX, NEEDS_SUMMARY, stopRequest, textOf } from "../src/stop";
import { fakeExec } from "./helpers";

const PASS = { ok: true, lines: ["gate: PASS"] };
const FAIL = { ok: false, lines: ["FAIL x"] };

describe("stopRequest", () => {
  test("owes nothing when the tree is clean, outside a repository, or unchanged since the start", () => {
    expect(stopRequest(undefined, "a", PASS, "", false)).toBeUndefined();
    expect(stopRequest("clean", "a", PASS, "", false)).toBeUndefined();
    expect(stopRequest("h1", "h1", FAIL, "", false)).toBeUndefined();
  });

  test("asks for a fix, with the gate output, when the gate fails", () => {
    const ask = stopRequest("h2", "h1", FAIL, "done", false);
    expect(ask).toContain(NEEDS_FIX);
    expect(ask).toContain("FAIL x");
  });

  test("asks for a Gate block once the gate passes", () => {
    expect(stopRequest("h2", "h1", PASS, "done", false)).toBe(NEEDS_SUMMARY);
    expect(stopRequest("h2", "h1", PASS, "done\nGate: exit 0", false)).toBeUndefined();
  });

  test("never asks twice about the same tree", () => {
    expect(stopRequest("h2", "h1", FAIL, "done", true)).toBeUndefined();
    expect(stopRequest("h2", "h1", PASS, "done", true)).toBeUndefined();
  });
});

describe("textOf", () => {
  test("reads string and block content, and nothing else", () => {
    expect(textOf({ content: "hi" })).toBe("hi");
    expect(
      textOf({ content: [{ type: "text", text: "a" }, { type: "image" }, { text: "b" }] }),
    ).toBe("a\n\nb");
    expect(textOf(undefined)).toBe("");
    expect(textOf({ content: 4 })).toBe("");
  });
});

describe("fingerprint", () => {
  const repo = (files: string, diff: string) =>
    fakeExec((cmd, args) => {
      if (args.includes("--show-toplevel")) return { stdout: "/r\n" };
      if (args.includes("--name-only")) return { stdout: files };
      if (args[0] === "diff") return { stdout: diff };
      return undefined;
    }).exec;

  test("is clean without source changes and changes with the diff", async () => {
    expect(await fingerprint(repo("README.md\n", ""), "/r")).toBe("clean");
    const a = await fingerprint(repo("a.rs\n", "+x"), "/r");
    const b = await fingerprint(repo("a.rs\n", "+y"), "/r");
    expect(a).not.toBe(b);
    expect(a).toBe(await fingerprint(repo("a.rs\n", "+x"), "/r"));
  });

  test("is undefined outside a repository", async () => {
    expect(await fingerprint(fakeExec(() => ({ code: 128 })).exec, "/x")).toBeUndefined();
  });
});
