import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

const LOG_PATH =
  process.env.PI_REVIEW_LOG_PATH ||
  "/home/me/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl";

const OUTPUT_DIR =
  process.env.DATASET_OUTPUT_DIR || path.join(import.meta.dir, "..", "data");

interface RawEvent {
  timestamp: string;
  event: string;
  requestId?: string;
  surface?: string;
  command?: string | null;
  path?: string | null;
  target?: string | null;
  resolution?: string | null;
  denialReason?: string | null;
  decidedBy?: {
    kind?: string;
    via?: string;
    reason?: string;
    pattern?: string;
  };
  matchedPattern?: string | null;
  toolInputPreview?: string | null;
  toolName?: string | null;
}

export interface JevClassifierSample {
  state: string;
  question: string;
  options: Array<{
    label: "A" | "B";
    key: "safe_allow" | "deny";
    description: string;
  }>;
  target: {
    label: "A" | "B";
    key: "safe_allow" | "deny";
  };
  metadata?: {
    requestId?: string;
    timestamp: string;
    surface?: string;
    resolution?: string;
    decidedBy?: string;
    denialReason?: string | null;
  };
}

export interface SftChatSample {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

const QUESTION = "Which listed permission decision best applies to this requested tool operation?";

const OPTIONS: JevClassifierSample["options"] = [
  {
    label: "A",
    key: "safe_allow",
    description: "Approve execution; benign development operation within permitted boundaries.",
  },
  {
    label: "B",
    key: "deny",
    description: "Deny execution; unsafe, out of bounds, destructive, or unauthorized action.",
  },
];

const SYSTEM_PROMPT =
  "You are a tool execution security classifier for agentic workflows. Given the requested tool action, surface, and parameters, determine whether to approve execution (A: safe_allow) or deny execution (B: deny).";

function formatState(event: RawEvent): string {
  const parts: string[] = [];
  if (event.toolName) parts.push(`Tool: ${event.toolName}`);
  if (event.surface) parts.push(`Surface: ${event.surface}`);
  if (event.command) parts.push(`Command:\n${event.command.trim()}`);
  if (event.path) parts.push(`Path: ${event.path.trim()}`);
  if (event.target) parts.push(`Target: ${event.target.trim()}`);
  if (event.toolInputPreview) parts.push(`Input Preview: ${event.toolInputPreview.trim()}`);
  if (event.matchedPattern) parts.push(`Matched Pattern: ${event.matchedPattern}`);
  return parts.join("\n");
}

async function extractDataset() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`Log file not found: ${LOG_PATH}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(LOG_PATH);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const waitingRequests = new Map<string, RawEvent>();
  const resolutionEvents = new Map<string, RawEvent>();
  const immediateBlocks: RawEvent[] = [];

  let totalLines = 0;

  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as RawEvent;
      if (item.event === "permission_request.waiting" && item.requestId) {
        waitingRequests.set(item.requestId, item);
      } else if (
        (item.event === "permission_request.approved" ||
          item.event === "permission_request.denied") &&
        item.requestId
      ) {
        resolutionEvents.set(item.requestId, item);
      } else if (item.event === "permission_request.blocked") {
        immediateBlocks.push(item);
      }
    } catch {}
  }

  const samples: JevClassifierSample[] = [];
  const surfaceStats: Record<string, { approved: number; denied: number }> = {};
  const recordStat = (surface: string, label: "safe_allow" | "deny") => {
    if (!surfaceStats[surface]) surfaceStats[surface] = { approved: 0, denied: 0 };
    if (label === "safe_allow") surfaceStats[surface].approved++;
    else surfaceStats[surface].denied++;
  };

  // Process paired requests
  for (const [requestId, req] of waitingRequests) {
    const res = resolutionEvents.get(requestId);
    if (!res) continue;
    if (!req.command && !req.path && !req.target && !req.toolInputPreview) {
      continue; // Skip empty prompts without command or path
    }

    const surface = req.surface || res.surface || req.toolName || "unknown";

    if (res.event === "permission_request.approved") {
      const state = formatState(req);
      if (!state.trim()) continue;

      samples.push({
        state,
        question: QUESTION,
        options: OPTIONS,
        target: { label: "A", key: "safe_allow" },
        metadata: {
          requestId,
          timestamp: res.timestamp,
          surface,
          resolution: res.resolution || "approved",
          decidedBy: res.decidedBy?.kind || "user",
        },
      });
      recordStat(surface, "safe_allow");
    } else if (res.event === "permission_request.denied") {
      if (res.resolution === "confirmation_unavailable") continue; // Exclude session timeout drops

      const state = formatState(req);
      if (!state.trim()) continue;

      samples.push({
        state,
        question: QUESTION,
        options: OPTIONS,
        target: { label: "B", key: "deny" },
        metadata: {
          requestId,
          timestamp: res.timestamp,
          surface,
          resolution: res.resolution || "denied",
          decidedBy: res.decidedBy?.kind || "user",
          denialReason: res.denialReason || null,
        },
      });
      recordStat(surface, "deny");
    }
  }

  // Process immediate policy blocks
  for (const block of immediateBlocks) {
    const surface = block.surface || block.toolName || "policy_rule";
    const state = formatState(block);
    if (!state.trim()) continue;

    samples.push({
      state,
      question: QUESTION,
      options: OPTIONS,
      target: { label: "B", key: "deny" },
      metadata: {
        requestId: block.requestId,
        timestamp: block.timestamp,
        surface,
        resolution: "policy_denied",
        decidedBy: "rule",
      },
    });
    recordStat(surface, "deny");
  }

  // Deterministic shuffle using LCG
  let seed = 42;
  const pseudoRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(pseudoRandom() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }

  // Split into 90% train, 10% dev
  const splitIdx = Math.floor(samples.length * 0.9);
  const trainSamples = samples.slice(0, splitIdx);
  const devSamples = samples.slice(splitIdx);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write JEV format
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "jev_train.jsonl"),
    trainSamples.map((s) => JSON.stringify(s)).join("\n") + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "jev_dev.jsonl"),
    devSamples.map((s) => JSON.stringify(s)).join("\n") + "\n",
    "utf8",
  );

  // Write SFT format
  const toSft = (s: JevClassifierSample): SftChatSample => ({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          state: s.state,
          question: s.question,
          options: s.options,
        }),
      },
      { role: "assistant", content: JSON.stringify(s.target) },
    ],
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "sft_train.jsonl"),
    trainSamples.map((s) => JSON.stringify(toSft(s))).join("\n") + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "sft_dev.jsonl"),
    devSamples.map((s) => JSON.stringify(toSft(s))).join("\n") + "\n",
    "utf8",
  );

  const totalApproved = samples.filter((s) => s.target.key === "safe_allow").length;
  const totalDenied = samples.filter((s) => s.target.key === "deny").length;

  console.log("=== Pi Permission Training Dataset Extraction Complete ===");
  console.log(`Total Log Lines Processed: ${totalLines}`);
  console.log(`Total Extracted Labeled Samples: ${samples.length}`);
  console.log(`  - Approved (A: safe_allow): ${totalApproved} (${((totalApproved / samples.length) * 100).toFixed(1)}%)`);
  console.log(`  - Denied (B: deny): ${totalDenied} (${((totalDenied / samples.length) * 100).toFixed(1)}%)`);
  console.log(`Train split (90%): ${trainSamples.length} samples`);
  console.log(`Dev split (10%): ${devSamples.length} samples`);
  console.log("\nSurface Breakdown:");
  for (const [surf, counts] of Object.entries(surfaceStats)) {
    console.log(`  - ${surf}: ${counts.approved} approved, ${counts.denied} denied (total: ${counts.approved + counts.denied})`);
  }
  console.log(`\nGenerated Artifacts in ${OUTPUT_DIR}:`);
  console.log(`  - jev_train.jsonl`);
  console.log(`  - jev_dev.jsonl`);
  console.log(`  - sft_train.jsonl`);
  console.log(`  - sft_dev.jsonl`);
}

extractDataset().catch((err) => {
  console.error("Extraction error:", err);
  process.exit(1);
});
