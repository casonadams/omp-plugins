import { brokenContract, gatingRows, partnerFiles, untestedRows } from "./parse";
import { addedSymbols } from "./symbols";
import type { Exec, GateReport } from "./types";

const SOURCE = /\.(rs|ts|tsx|js|jsx|mjs|py|go|c|h|cc|cpp|hpp|java|kt|swift|rb|php|cs|scala|dart)$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbd2cd4c";
const MAX_ROWS = 10;
const MAX_PARTNERS = 5;
const BINARIES = ["ripwire-rs", "ripwire"];

/** The first ripwire CLI that answers `--version`: `ripwire-rs`, else `ripwire`. */
export async function resolveBinary(exec: Exec, cwd: string): Promise<string | undefined> {
  for (const bin of BINARIES) {
    const probe = await exec(bin, ["--version"], { cwd }).catch(() => undefined);
    if (probe?.code === 0) return bin;
  }
  return undefined;
}

async function git(exec: Exec, cwd: string, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd });
  return result.code === 0 ? result.stdout : "";
}

/** The commit to compare with: HEAD, or the empty tree in a repository without commits. */
async function baseRevision(exec: Exec, cwd: string): Promise<string> {
  const head = await exec("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd });
  return head.code === 0 ? "HEAD" : EMPTY_TREE;
}

/** Source files that differ from `base`: tracked changes plus untracked files. */
export async function changedSources(exec: Exec, cwd: string, base: string): Promise<string[]> {
  const tracked = await git(exec, cwd, ["diff", base, "--name-only", "--diff-filter=ACMR"]);
  const untracked = await git(exec, cwd, ["ls-files", "--others", "--exclude-standard"]);
  const all = `${tracked}\n${untracked}`.split("\n").filter(Boolean);
  return [...new Set(all)].filter((file) => SOURCE.test(file));
}

interface StepContext {
  exec: Exec;
  bin: string;
  cwd: string;
  base: string;
  files: string[];
}

interface Step {
  name: string;
  run(ctx: StepContext): Promise<GateReport>;
}

const pass = (line: string): GateReport => ({ ok: true, lines: [`ok    ${line}`] });

/** Blocking steps, in order. The gate stops at the first one that fails. */
const editCheck: Step = {
  name: "edit-check",
  async run({ exec, bin, cwd, base, files }) {
    const diff = await git(exec, cwd, ["diff", base, "-U0", "--", ...files]);
    const symbols = addedSymbols(diff);
    const lines: string[] = [];
    for (const symbol of symbols) {
      const result = await exec(bin, [".", `--edit-check=${symbol}`], { cwd });
      const broken = brokenContract(result.stdout);
      if (broken) {
        lines.push(
          `${symbol}: contract ${broken.status}, ${broken.callers} caller(s) no longer fit`,
        );
      }
    }
    if (lines.length > 0) return { ok: false, lines };
    return pass(`${symbols.length} public symbol(s), no caller broken`);
  },
};

const qualityDelta: Step = {
  name: "quality-delta",
  async run({ exec, bin, cwd }) {
    const result = await exec(bin, [".", "--quality-delta"], { cwd });
    if (result.code !== 2) return pass(`no gating regressions (exit ${result.code})`);
    return { ok: false, lines: gatingRows(result.stdout).slice(0, MAX_ROWS) };
  },
};

const BLOCKING: Step[] = [editCheck, qualityDelta];

/** Information steps, run once every blocking step is green. They never block. */
async function listUntested({ exec, bin, cwd, files }: StepContext): Promise<string[]> {
  const result = await exec(bin, [".", `--test-gate=${files.join(",")}`], { cwd });
  const rows = untestedRows(result.stdout);
  if (rows.length === 0) return ["ok    test-gate: no untested rows"];
  const shown = rows.slice(0, MAX_ROWS).map((r) => `        ${r}`);
  return [`note  test-gate: ${rows.length} untested row(s); add a test or say why not:`, ...shown];
}

async function listPartners({ exec, bin, cwd, files }: StepContext): Promise<string[]> {
  const result = await exec(bin, [".", `--situ=${files.join(",")}`], { cwd });
  const partners = partnerFiles(result.stdout).slice(0, MAX_PARTNERS);
  if (partners.length === 0) return [];
  return ["note  files that usually change with these:", ...partners.map((p) => `        ${p}`)];
}

async function baselineNote({ exec, bin, cwd }: StepContext): Promise<string[]> {
  const found = await exec("test", ["-f", `${cwd}/.${bin}_quality_baseline`], { cwd });
  if (found.code === 0) return [];
  const hint = `run "${bin} . --quality-baseline" at the start of a task`;
  return [`note  no quality baseline: quality-delta compares with nothing; ${hint}`];
}

function failure(step: Step, index: number, report: GateReport): GateReport {
  const where = `step ${index + 1} of ${BLOCKING.length}, ${step.name}`;
  const rows = report.lines.map((line) => `        ${line}`);
  const hint =
    "Fix this one thing and commit again; the next step runs after it is green. Do not acknowledge rows to get past it.";
  return { ok: false, lines: [`gate: BLOCKED at ${where}`, ...rows, hint] };
}

export async function runGate(exec: Exec, cwd: string): Promise<GateReport> {
  const bin = await resolveBinary(exec, cwd);
  if (!bin)
    return {
      ok: true,
      lines: ["gate: neither ripwire-rs nor ripwire is installed, nothing to check"],
    };
  const top = (await git(exec, cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!top) return { ok: true, lines: ["gate: not in a git repository, nothing to check"] };

  const base = await baseRevision(exec, top);
  const files = await changedSources(exec, top, base);
  if (files.length === 0) return { ok: true, lines: ["gate: no source changed"] };

  const ctx: StepContext = { exec, bin, cwd: top, base, files };
  const lines = [
    `gate: ${files.length} source file(s) differ from ${base === "HEAD" ? "HEAD" : "an empty repository"}`,
  ];
  for (const [index, step] of BLOCKING.entries()) {
    const report = await step.run(ctx);
    if (!report.ok) return failure(step, index, report);
    lines.push(...report.lines.map((line) => line.replace(/^ok {4}/, `ok    ${step.name}: `)));
  }
  lines.push(
    ...(await baselineNote(ctx)),
    ...(await listUntested(ctx)),
    ...(await listPartners(ctx)),
    "gate: PASS",
  );
  return { ok: true, lines };
}
