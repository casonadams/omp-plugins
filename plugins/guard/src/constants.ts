import { readFileSync } from "node:fs";

export const CRITICAL_DANGER_REGEX =
  /(\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([/~]|\.\.|\*)|:\(\)\s*\{\s*:\|:&\s*\};:|\bmkfs\b|\bdd\s+if=|>+\s*\/dev\/sd|\bgit\s+reset\s+--hard\b)/i;

export const GUARD_SYSTEM_PROMPT = readFileSync(
  new URL("./guard-prompt.md", import.meta.url),
  "utf8",
).trim();
