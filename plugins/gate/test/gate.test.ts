import { describe, expect, test } from "bun:test";
import { resolveBinary, runGate } from "../src/gate";
import { fakeExec, NOT_FOUND, type Handler } from "./helpers";

const REPO: Handler = (cmd, args) => {
  if (cmd === "git" && args[0] === "rev-parse" && args.includes("--show-toplevel"))
    return { stdout: "/r\n" };
  if (cmd === "git" && args[0] === "diff" && args.includes("--name-only"))
    return { stdout: "src/a.rs\ndocs/x.md\n" };
  if (cmd === "git" && args[0] === "diff") return { stdout: "+pub fn changed() {}\n" };
  if (cmd === "test") return { code: 0 };
  return undefined;
};

function withRipwire(extra: Handler, bin = "ripwire-rs"): Handler {
  return (cmd, args) => {
    if (cmd !== "git" && cmd !== "test" && cmd !== bin) return NOT_FOUND;
    return extra(cmd, args) ?? REPO(cmd, args);
  };
}

describe("resolveBinary", () => {
  test("prefers ripwire-rs", async () => {
    const { exec } = fakeExec(() => undefined);
    expect(await resolveBinary(exec, "/r")).toBe("ripwire-rs");
  });

  test("falls back to ripwire when ripwire-rs is not installed", async () => {
    const { exec } = fakeExec((cmd) => (cmd === "ripwire-rs" ? NOT_FOUND : undefined));
    expect(await resolveBinary(exec, "/r")).toBe("ripwire");
  });

  test("is undefined when neither answers, even if running one throws", async () => {
    const exec = async () => {
      throw new Error("spawn ENOENT");
    };
    expect(await resolveBinary(exec, "/r")).toBeUndefined();
  });
});

describe("runGate", () => {
  test("passes with a note when no ripwire CLI is installed", async () => {
    const { exec } = fakeExec((cmd) => (cmd.startsWith("ripwire") ? NOT_FOUND : undefined));
    const report = await runGate(exec, "/r");
    expect(report.ok).toBe(true);
    expect(report.lines[0]).toContain("neither ripwire-rs nor ripwire");
  });

  test("passes with nothing to check outside a repository and with no source change", async () => {
    expect(
      (await runGate(fakeExec((c) => (c === "git" ? { code: 128 } : undefined)).exec, "/x"))
        .lines[0],
    ).toContain("not in a git repository");
    const clean = fakeExec(
      withRipwire((cmd, args) =>
        cmd === "git" && args.includes("--name-only") ? { stdout: "README.md\n" } : undefined,
      ),
    );
    expect((await runGate(clean.exec, "/r")).lines).toEqual(["gate: no source changed"]);
  });

  test("an unborn branch is compared with the empty tree", async () => {
    const { exec, calls } = fakeExec(
      withRipwire((cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" && args.includes("HEAD") ? { code: 1 } : undefined,
      ),
    );
    const report = await runGate(exec, "/r");
    expect(report.lines[0]).toContain("an empty repository");
    expect(calls.some((c) => c.startsWith("git diff 4b825dc"))).toBe(true);
  });

  test("passes and lists untested rows and co-change partners without blocking", async () => {
    const { exec } = fakeExec(
      withRipwire((cmd, args) => {
        if (cmd !== "ripwire-rs") return undefined;
        if (args.some((a) => a.startsWith("--test-gate")))
          return { code: 4, stdout: '<u sym="f" p="src/a.rs" l="4"/>' };
        if (args.some((a) => a.startsWith("--situ")))
          return { stdout: '<partner path="docs/X.md (36%)"/>' };
        if (args.some((a) => a.startsWith("--edit-check")))
          return { stdout: '<edit-check status="unchanged" incompatible="2">' };
        return undefined;
      }),
    );
    const report = await runGate(exec, "/r");
    expect(report.ok).toBe(true);
    const text = report.lines.join("\n");
    expect(text).toContain("f (src/a.rs:4)");
    expect(text).toContain("docs/X.md (36%)");
    expect(text).toContain("gate: PASS");
  });

  test("blocks on a changed contract with broken callers", async () => {
    const { exec } = fakeExec(
      withRipwire((cmd, args) =>
        cmd === "ripwire-rs" && args.some((a) => a.startsWith("--edit-check"))
          ? { stdout: '<edit-check status="contract-change" incompatible="3">' }
          : undefined,
      ),
    );
    const report = await runGate(exec, "/r");
    expect(report.ok).toBe(false);
    const text = report.lines.join("\n");
    expect(text).toContain("BLOCKED at step 1 of 2, edit-check");
    expect(text).toContain("changed: contract contract-change, 3 caller(s)");
  });

  test("blocks on gating quality regressions and uses the ripwire fallback binary", async () => {
    const { exec, calls } = fakeExec(
      withRipwire((cmd, args) => {
        if (cmd === "ripwire" && args.includes("--quality-delta"))
          return { code: 2, stdout: '<r kind="dup" gating="1"/>' };
        return undefined;
      }, "ripwire"),
    );
    const report = await runGate(exec, "/r");
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain('<r kind="dup" gating="1"/>');
    expect(calls.every((c) => !c.startsWith("ripwire-rs ") || c === "ripwire-rs --version")).toBe(
      true,
    );
  });

  test("says so when there is no quality baseline", async () => {
    const { exec } = fakeExec(withRipwire((cmd) => (cmd === "test" ? { code: 1 } : undefined)));
    const report = await runGate(exec, "/r");
    expect(report.lines.join("\n")).toContain('run "ripwire-rs . --quality-baseline"');
  });

  test("looks for the baseline file the binary writes, named after it", async () => {
    for (const bin of ["ripwire-rs", "ripwire"]) {
      const { exec, calls } = fakeExec(withRipwire(() => undefined, bin));
      await runGate(exec, "/r");
      expect(calls).toContain(`test -f /r/.${bin}_quality_baseline`);
    }
  });

  test("stops at the first failing step and shows only that one", async () => {
    const { exec, calls } = fakeExec(
      withRipwire((cmd, args) => {
        if (cmd !== "ripwire-rs") return undefined;
        if (args.some((a) => a.startsWith("--edit-check")))
          return { stdout: '<edit-check status="contract-change" incompatible="1">' };
        if (args.includes("--quality-delta"))
          return { code: 2, stdout: '<r kind="dup" gating="1"/>' };
        return undefined;
      }),
    );
    const report = await runGate(exec, "/r");
    expect(report.lines.join("\n")).not.toContain("quality-delta");
    expect(calls.some((c) => c.includes("--quality-delta"))).toBe(false);
    expect(calls.some((c) => c.includes("--test-gate"))).toBe(false);
  });

  test("a later step runs only after the earlier one is green", async () => {
    const { exec } = fakeExec(
      withRipwire((cmd, args) =>
        cmd === "ripwire-rs" && args.includes("--quality-delta") ? { code: 2 } : undefined,
      ),
    );
    const text = (await runGate(exec, "/r")).lines.join("\n");
    expect(text).toContain("BLOCKED at step 2 of 2, quality-delta");
  });
});
