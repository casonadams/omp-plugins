import { commitDirectory, runsGitCommit } from "./src/commit";
import { runGate } from "./src/gate";
import { fingerprint, stopRequest, textOf } from "./src/stop";
import type {
  GateContext,
  GateReport,
  PiExtensionAPI,
  SessionStopEvent,
  ToolCallEvent,
} from "./src/types";

export { runsGitCommit } from "./src/commit";
export { runGate } from "./src/gate";
export { addedSymbols } from "./src/symbols";
export type * from "./src/types";

export const ENV_DISABLE = "OMP_GATE_DISABLE";

export default function registerGate(pi: PiExtensionAPI): void {
  if (process.env[ENV_DISABLE]) return;
  let start: string | undefined;
  // One verdict per working-tree state: the same tree is never gated twice, and never asked about twice.
  const verdicts = new Map<string, GateReport>();
  const asked = new Set<string>();

  async function verdict(cwd: string, tree: string | undefined): Promise<GateReport> {
    const known = tree ? verdicts.get(tree) : undefined;
    if (known) return known;
    const report = await runGate(pi.exec, cwd);
    if (tree) verdicts.set(tree, report);
    return report;
  }

  pi.on("session_start", async (_event: never, ctx: GateContext) => {
    start = await fingerprint(pi.exec, ctx.cwd);
    verdicts.clear();
    asked.clear();
    if (ctx.hasUI)
      ctx.ui?.notify("gate active: git commit is blocked until the gate passes", "info");
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx: GateContext) => {
    if (event.toolName !== "bash") return;
    const command = String(event.input?.command ?? "");
    if (!runsGitCommit(command)) return;
    const cwd = commitDirectory(command, String(event.input?.cwd ?? ctx.cwd));
    let report: GateReport;
    try {
      report = await verdict(cwd, await fingerprint(pi.exec, cwd));
    } catch (error) {
      // A gate that cannot run must not take the commit down with it, but it must not pass silently.
      return {
        additionalContext: `The gate could not run (${String(error)}); this commit was not checked.`,
      };
    }
    const output = report.lines.join("\n");
    if (report.ok) return { additionalContext: `Gate passed before this commit:\n${output}` };
    return {
      block: true,
      reason: `The gate blocked this commit. Fix the causes below, then commit in a separate command.\n\n${output}`,
    };
  });

  pi.on("session_stop", async (event: SessionStopEvent, ctx: GateContext) => {
    const now = await fingerprint(pi.exec, ctx.cwd);
    if (now === undefined || now === "clean" || now === start) return;
    const ask = stopRequest(
      now,
      start,
      await verdict(ctx.cwd, now),
      textOf(event.last_assistant_message),
      asked.has(now),
    );
    if (!ask) return;
    asked.add(now);
    return { continue: true, additionalContext: ask };
  });
}
