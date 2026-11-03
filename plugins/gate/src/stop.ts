import { createHash } from "node:crypto";
import { changedSources } from "./gate";
import type { Exec, GateReport } from "./types";

/** A digest of the working tree's difference from HEAD, or `clean`; undefined outside a repository. */
export async function fingerprint(exec: Exec, cwd: string): Promise<string | undefined> {
  const root = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (root.code !== 0) return undefined;
  const top = root.stdout.trim();
  const files = await changedSources(exec, top, "HEAD");
  if (files.length === 0) return "clean";
  const diff = await exec("git", ["diff", "HEAD"], { cwd: top });
  return createHash("sha1")
    .update(`${files.join("\n")}\n${diff.stdout}`)
    .digest("hex");
}

export function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = content.map((b: unknown) =>
    b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "",
  );
  return parts.join("\n");
}

export const NEEDS_SUMMARY =
  "The gate passed, but your reply has no Gate block. End it with `Gate: <result>`, the untested rows it listed " +
  "(or `none`), and any acknowledgements used.";

export const NEEDS_FIX =
  "Source changed in this session and the gate does not pass on it. Fix what it reports, then end your reply " +
  "with a Gate block (result, untested rows, acknowledgements used).";

/**
 * What to ask of the agent before it finishes, or undefined when nothing is owed. `asked` is whether
 * this exact working tree was already asked about: each tree state is asked about once, so a reply that
 * cannot satisfy the request never loops.
 */
export function stopRequest(
  now: string | undefined,
  start: string | undefined,
  report: GateReport,
  reply: string,
  asked: boolean,
): string | undefined {
  if (now === undefined || now === "clean" || now === start || asked) return undefined;
  if (!report.ok) return `${NEEDS_FIX}\n\n${report.lines.join("\n")}`;
  return /\bGate:/i.test(reply) ? undefined : NEEDS_SUMMARY;
}
