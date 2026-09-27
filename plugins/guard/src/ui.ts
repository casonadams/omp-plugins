import type { BlockResult, ExtensionContext } from "./types";

function blockedHeadless(reason: string): BlockResult {
  return {
    block: true,
    reason: `[Bash Guard] Blocked unsafe command (headless mode): ${reason}`,
  };
}

export async function promptUser(
  ctx: ExtensionContext | undefined,
  command: string,
  reason: string,
): Promise<BlockResult | void> {
  if (!ctx?.hasUI) {
    return blockedHeadless(reason);
  }

  if (typeof ctx.ui?.askDialog === "function") {
    const res = await ctx.ui.askDialog([
      {
        id: "bash_guard_approval",
        header: "Bash Guard",
        question: `Security Audit:\n${reason.trim()}\n \nAllow execution?`,
        recommended: 1,
        options: [
          {
            label: "Proceed",
            description: "Execute the command",
            preview: `\`\`\`bash\n${command}\n\`\`\``,
          },
          {
            label: "Cancel",
            description: "Block execution",
          },
        ],
      },
    ]);

    if (res?.kind === "submit") {
      const selected = res.results[0]?.selectedOptions[0];
      if (selected === "Proceed") {
        return;
      }
      if (res.results[0]?.customInput) {
        return {
          block: true,
          reason: `User denied execution with feedback: ${res.results[0].customInput}`,
        };
      }
    }

    return {
      block: true,
      reason: `User denied execution: ${reason}`,
    };
  }

  if (typeof ctx.ui?.confirm === "function") {
    const approved = await ctx.ui.confirm(
      "Bash Guard",
      `Security Audit:\n${reason}\n\nCommand:\n$ ${command}\n\nAllow execution?`,
    );
    if (approved) return;
    return { block: true, reason: `User denied execution: ${reason}` };
  }

  return blockedHeadless(reason);
}
