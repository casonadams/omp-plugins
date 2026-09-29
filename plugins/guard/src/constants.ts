import { readFileSync } from "node:fs";
import type { SecurityAudit } from "./types";

export const GUARD_ROLE_FALLBACKS = ["@guard", "@judge", "@smol"] as const;

export const CRITICAL_DANGER_REGEX =
  /(\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([/~]|\.\.|\*)|:\(\)\s*\{\s*:\|:&\s*\};:|\bmkfs\b|\bdd\s+if=|>+\s*\/dev\/sd|\bgit\s+reset\s+--hard\b)/i;

export const GUARD_SYSTEM_PROMPT = readFileSync(
  new URL("./guard-prompt.md", import.meta.url),
  "utf8",
).trim();

export function getCriticalDangerAudit(command: string): SecurityAudit {
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([/~]|\.\.|\*)/i.test(command)) {
    return {
      action: "Recursively deletes root, home, parent, or wildcard files",
      reason: "Critical destructive filesystem wipe detected.",
    };
  }
  if (/:\(\)\s*\{\s*:\|:&\s*\};:/i.test(command)) {
    return {
      action: "Executes a shell fork bomb",
      reason: "Catastrophic system denial of service / resource exhaustion.",
    };
  }
  if (/\bmkfs\b/i.test(command)) {
    return {
      action: "Formats disk partition or builds a new filesystem",
      reason: "Critical destructive drive format detected.",
    };
  }
  if (/\bdd\s+if=/i.test(command)) {
    return {
      action: "Performs low-level raw byte copying or writing with dd",
      reason: "Potential low-level raw disk or partition overwrite.",
    };
  }
  if (/>+\s*\/dev\/sd/i.test(command)) {
    return {
      action: "Redirects output directly into storage device node (/dev/sd*)",
      reason: "Direct raw storage device overwrite detected.",
    };
  }
  if (/\bgit\s+reset\s+--hard\b/i.test(command)) {
    return {
      action: "Resets git working tree and index discarding uncommitted changes",
      reason: "Irreversible loss of git working tree state and uncommitted changes.",
    };
  }
  return {
    action: "Executes high-risk destructive shell command",
    reason: "Critical destructive or irreversible infrastructure action detected.",
  };
}
