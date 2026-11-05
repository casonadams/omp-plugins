import type { BlockResult, ExtensionContext, SecurityAudit } from "./types";

export type PromptDecisionKind = "proceed" | "cancel" | "feedback" | "headless";

export interface PromptOutcome {
  blockResult?: BlockResult;
  decision: {
    kind: PromptDecisionKind;
    feedback?: string;
  };
}
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
): Promise<PromptOutcome> {
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
    if (selected === "Proceed") {
      return { decision: { kind: "proceed" } };
    }
    if (res.results[0]?.customInput) {
      return {
        blockResult: {
          block: true,
          reason: `User denied execution with feedback: ${res.results[0].customInput}`,
        },
        decision: { kind: "feedback", feedback: res.results[0].customInput },
      };
    }
  }

  return {
    blockResult: {
      block: true,
      reason: `User denied execution: ${audit.auditSummary}`,
    },
    decision: { kind: "cancel" },
  };
}

async function promptViaConfirm(
  ui: NonNullable<ExtensionContext["ui"]>,
  header: string,
  command: string,
  audit: FormattedAudit,
  language: string,
): Promise<PromptOutcome> {
  const approved = await ui.confirm!(
    header,
    `Security Audit:\n${audit.auditBlock}\n\n${language === "bash" ? "Command:\n$" : "Script:"} ${command}`,
  );
  if (approved) {
    return { decision: { kind: "proceed" } };
  }
  return {
    blockResult: { block: true, reason: `User denied execution: ${audit.auditSummary}` },
    decision: { kind: "cancel" },
  };
}

export async function promptUserDetailed(
  ctx: ExtensionContext | undefined,
  command: string,
  audit: string | SecurityAudit,
  language: string = "bash",
): Promise<PromptOutcome> {
  const formatted = formatAudit(audit);
  const guardHeader = language === "bash" ? "Bash Guard" : "Eval Guard";
  const blockedPrefix =
    language === "bash"
      ? "[Bash Guard] Blocked unsafe command"
      : "[Eval Guard] Blocked unsafe script";

  if (!ctx?.hasUI) {
    return {
      blockResult: {
        block: true,
        reason: `${blockedPrefix} (headless mode): ${formatted.auditSummary}`,
      },
      decision: { kind: "headless" },
    };
  }

  if (typeof ctx.ui?.askDialog === "function") {
    return promptViaAskDialog(ctx.ui, guardHeader, command, formatted, language);
  }

  if (typeof ctx.ui?.confirm === "function") {
    return promptViaConfirm(ctx.ui, guardHeader, command, formatted, language);
  }

  return {
    blockResult: {
      block: true,
      reason: `${blockedPrefix} (headless mode): ${formatted.auditSummary}`,
    },
    decision: { kind: "headless" },
  };
}

export async function promptUser(
  ctx: ExtensionContext | undefined,
  command: string,
  audit: string | SecurityAudit,
  language: string = "bash",
): Promise<BlockResult | void> {
  const outcome = await promptUserDetailed(ctx, command, audit, language);
  return outcome.blockResult;
}
