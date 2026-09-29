import type { BlockResult, ExtensionContext, SecurityAudit } from "./types";

export async function promptUser(
  ctx: ExtensionContext | undefined,
  command: string,
  audit: string | SecurityAudit,
): Promise<BlockResult | void> {
  const normalizedAudit: SecurityAudit = typeof audit === "string" ? { reason: audit } : audit;
  const auditBlock = normalizedAudit.action
    ? `Action: ${normalizedAudit.action}\nRisk: ${normalizedAudit.reason}`
    : normalizedAudit.reason;
  const auditSummary = normalizedAudit.action
    ? `${normalizedAudit.reason} (Action: ${normalizedAudit.action})`
    : normalizedAudit.reason;

  if (!ctx?.hasUI) {
    return {
      block: true,
      reason: `[Bash Guard] Blocked unsafe command (headless mode): ${auditSummary}`,
    };
  }

  if (typeof ctx.ui?.askDialog === "function") {
    const res = await ctx.ui.askDialog([
      {
        id: "bash_guard_approval",
        header: "Bash Guard",
        question: `Security Audit:\n${auditBlock.trim()}\n \nAllow execution?`,
        recommended: 0,
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
      reason: `User denied execution: ${auditSummary}`,
    };
  }

  if (typeof ctx.ui?.confirm === "function") {
    const approved = await ctx.ui.confirm(
      "Bash Guard",
      `Security Audit:\n${auditBlock}\n\nCommand:\n$ ${command}\n\nAllow execution?`,
    );
    if (approved) return;
    return { block: true, reason: `User denied execution: ${auditSummary}` };
  }

  return {
    block: true,
    reason: `[Bash Guard] Blocked unsafe command (headless mode): ${auditSummary}`,
  };
}
