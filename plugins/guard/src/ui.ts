import type { BlockResult, ExtensionContext, SecurityAudit } from "./types";

interface FormattedAudit {
  auditBlock: string;
  auditSummary: string;
}

function formatAudit(audit: string | SecurityAudit): FormattedAudit {
  const normalized: SecurityAudit = typeof audit === "string" ? { reason: audit } : audit;
  const auditBlock = normalized.action
    ? `Action: ${normalized.action}\nRisk: ${normalized.reason}`
    : normalized.reason;
  const auditSummary = normalized.action
    ? `${normalized.reason} (Action: ${normalized.action})`
    : normalized.reason;
  return { auditBlock, auditSummary };
}

async function promptViaAskDialog(
  ui: NonNullable<ExtensionContext["ui"]>,
  header: string,
  command: string,
  audit: FormattedAudit,
  language: string,
): Promise<BlockResult | void> {
  const res = await ui.askDialog!([
    {
      id: "guard_approval",
      header,
      question: `Security Audit:\n${audit.auditBlock.trim()}`,
      recommended: 0,
      options: [
        {
          label: "Proceed",
          description: `Execute the ${language === "bash" ? "command" : "script"}`,
          preview: `\`\`\`${language}\n${command}\n\`\`\``,
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
    if (selected === "Proceed") return;
    if (res.results[0]?.customInput) {
      return {
        block: true,
        reason: `User denied execution with feedback: ${res.results[0].customInput}`,
      };
    }
  }

  return {
    block: true,
    reason: `User denied execution: ${audit.auditSummary}`,
  };
}

async function promptViaConfirm(
  ui: NonNullable<ExtensionContext["ui"]>,
  header: string,
  command: string,
  audit: FormattedAudit,
  language: string,
): Promise<BlockResult | void> {
  const approved = await ui.confirm!(
    header,
    `Security Audit:\n${audit.auditBlock}\n\n${language === "bash" ? "Command:\n$" : "Script:"} ${command}`,
  );
  if (approved) return;
  return { block: true, reason: `User denied execution: ${audit.auditSummary}` };
}

export async function promptUser(
  ctx: ExtensionContext | undefined,
  command: string,
  audit: string | SecurityAudit,
  language: string = "bash",
): Promise<BlockResult | void> {
  const formatted = formatAudit(audit);
  const guardHeader = language === "bash" ? "Bash Guard" : "Eval Guard";
  const blockedPrefix =
    language === "bash"
      ? "[Bash Guard] Blocked unsafe command"
      : "[Eval Guard] Blocked unsafe script";

  if (!ctx?.hasUI) {
    return {
      block: true,
      reason: `${blockedPrefix} (headless mode): ${formatted.auditSummary}`,
    };
  }

  if (typeof ctx.ui?.askDialog === "function") {
    return promptViaAskDialog(ctx.ui, guardHeader, command, formatted, language);
  }

  if (typeof ctx.ui?.confirm === "function") {
    return promptViaConfirm(ctx.ui, guardHeader, command, formatted, language);
  }

  return {
    block: true,
    reason: `${blockedPrefix} (headless mode): ${formatted.auditSummary}`,
  };
}
