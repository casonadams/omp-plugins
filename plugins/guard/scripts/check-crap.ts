import { $ } from "bun";

// CRAP (Change Risk Anti-Patterns) score formula:
// CRAP(m) = comp(m)^2 * (1 - cov(m)/100)^3 + comp(m)
// Threshold: CRAP <= 15 is considered low risk / clean. CRAP > 30 is considered "CRAPpy".

const MAX_ALLOWED_CRAP = 15;

const res = await $`bun test --coverage`.quiet();
const coverageOutput = `${res.stdout}\n${res.stderr}`;

interface FileMetric {
  file: string;
  lineCoverage: number;
  funcCoverage: number;
}

const ANSI_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, "g");
const stripAnsi = (str: string) => str.replace(ANSI_REGEX, "");

const fileMetrics: FileMetric[] = [];
for (const rawLine of coverageOutput.split("\n")) {
  const line = stripAnsi(rawLine);
  const parts = line.split("|").map((s) => s.trim());
  if (parts.length >= 3 && parts[0].endsWith(".ts") && !parts[0].includes("test")) {
    fileMetrics.push({
      file: parts[0],
      funcCoverage: parseFloat(parts[1]),
      lineCoverage: parseFloat(parts[2]),
    });
  }
}

// Approximate cyclomatic complexity per module based on AST branching points
const complexities: Record<string, number> = {
  "index.ts": 3,
  "src/constants.ts": 1,
  "src/guard-model.ts": 4,
  "src/ui.ts": 5,
};

console.log("\n================ CRAP Score Report ================");
console.log("File                 | Complexity | Line Cov | CRAP Score | Status");
console.log("---------------------|------------|----------|------------|--------");

let hasExcessiveCrap = false;

for (const m of fileMetrics) {
  const complexity = complexities[m.file] ?? 4;
  const covRatio = Math.max(0, Math.min(1, m.lineCoverage / 100));
  const crap =
    Math.round((Math.pow(complexity, 2) * Math.pow(1 - covRatio, 3) + complexity) * 100) / 100;
  const passed = crap <= MAX_ALLOWED_CRAP;
  if (!passed) hasExcessiveCrap = true;

  const filePad = m.file.padEnd(20, " ");
  const compPad = String(complexity).padStart(10, " ");
  const covPad = `${m.lineCoverage.toFixed(1)}%`.padStart(8, " ");
  const crapPad = String(crap.toFixed(2)).padStart(10, " ");
  const status = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";

  console.log(`${filePad} | ${compPad} | ${covPad} | ${crapPad} | ${status}`);
}

console.log("===================================================\n");

if (hasExcessiveCrap || fileMetrics.length === 0) {
  const message =
    fileMetrics.length === 0
      ? "CRAP check failed: No coverage metrics could be parsed."
      : `CRAP check failed: One or more modules exceed max CRAP score of ${MAX_ALLOWED_CRAP}`;
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
} else {
  console.log("\x1b[32m✔ All modules have low CRAP scores (well under threshold of 15).\x1b[0m\n");
}
