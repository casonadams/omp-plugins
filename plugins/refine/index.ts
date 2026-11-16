import { completions, parseArgs, usage } from "./src/args";
import { discoverRepoInventory } from "./src/inventory";
import { buildScanPrompt } from "./src/prompt";
import { MAX_SCOPES, planScopes } from "./src/scopes";
import type { Profile } from "./src/profiles";
import type { RefineAPI, RefineContext } from "./src/types";

export type * from "./src/types";

export default function registerRefine(pi: RefineAPI): void {
  pi.registerCommand("refine", {
    description:
      "Read-only repo scan: /refine <review|security|performance|reliability|architecture>",
    getArgumentCompletions: completions,
    handler: async (args, ctx) => {
      const request = parseArgs(args);
      if (request.kind === "help") return ctx.ui.notify(usage(), "info");
      if (request.kind === "error") return ctx.ui.notify(`${request.message}\n${usage()}`, "error");
      if (!ctx.isIdle()) return ctx.ui.notify("Agent is busy. Run /refine when idle.", "warning");
      await startScan(pi, ctx, request.profile);
    },
  });
}

async function startScan(pi: RefineAPI, ctx: RefineContext, profile: Profile): Promise<void> {
  const inventory = await discoverRepoInventory(ctx.cwd);
  if (!ctx.isIdle()) {
    return ctx.ui.notify(
      "Agent became busy during inventory. Run /refine again when idle.",
      "warning",
    );
  }
  ctx.ui.notify(`refine ${profile} ${inventory.scanMode} scan started`, "info");
  pi.sendMessage(
    {
      customType: "refine-scan",
      content: buildScanPrompt(
        profile,
        inventory,
        planScopes(inventory.fileDirs, MAX_SCOPES[inventory.scanMode]),
      ),
      display: true,
    },
    { triggerTurn: true },
  );
}
