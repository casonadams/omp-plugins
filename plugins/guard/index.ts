import { isAllowlistedCommand, loadGuardConfig, resolveProductionMarkers } from "./src/config";
import { CRITICAL_DANGER_REGEX, getCriticalDangerAudit } from "./src/constants";
import { evaluateCommandSafetyWithFallback, resolveGuardCandidates } from "./src/guard-model";
import {
  createDecisionRecord,
  isTelemetryEnabled,
  logGuardDecision,
  resolveTelemetryPath,
  type DecisionSource,
  type DecisionTargetKey,
} from "./src/telemetry";
import type { BlockResult, ExtensionContext, PiExtensionAPI, ToolCallEvent } from "./src/types";
import { promptUser, promptUserDetailed, type PromptOutcome } from "./src/ui";

export {
  CRITICAL_DANGER_REGEX,
  GUARD_ROLE_FALLBACKS,
  GUARD_SYSTEM_PROMPT,
  getCriticalDangerAudit,
} from "./src/constants";
export {
  evaluateCommandSafety,
  evaluateCommandSafetyWithFallback,
  evaluateSystemOneSafety,
  getConfiguredModelRole,
  isDecisionModel,
  isKeylessModel,
  parseGuardOutput,
  parseSystemOneOutput,
  resolveGuardCandidates,
  resolveGuardModel,
} from "./src/guard-model";
export { isAllowlistedCommand, loadGuardConfig, resolveProductionMarkers } from "./src/config";
export {
  DEFAULT_JEV_OPTIONS,
  DEFAULT_JEV_QUESTION,
  TARGET_LABELS,
  createDecisionRecord,
  isTelemetryEnabled,
  logGuardDecision,
  resolveTelemetryPath,
} from "./src/telemetry";
export type {
  DecisionSource,
  DecisionTargetKey,
  JevDecisionOption,
  JevDecisionRecord,
} from "./src/telemetry";
export type * from "./src/types";
export { promptUser, promptUserDetailed } from "./src/ui";
export type { PromptDecisionKind, PromptOutcome } from "./src/ui";

export default function registerBashGuard(pi: PiExtensionAPI) {
  pi.on(
    "tool_call",
    async (event: ToolCallEvent, ctx?: ExtensionContext): Promise<BlockResult | void> => {
      let content: string | undefined;
      let language = "bash";

      if (event.toolName === "bash") {
        content = typeof event.input?.command === "string" ? event.input.command.trim() : undefined;
        language = "bash";
      } else if (event.toolName === "eval") {
        content = typeof event.input?.code === "string" ? event.input.code.trim() : undefined;
        language = typeof event.input?.language === "string" ? event.input.language : "js";
      } else {
        return;
      }

      if (!content) return;
      const startTime = Date.now();
      const guardConfig = loadGuardConfig(ctx?.cwd);
      const markers = resolveProductionMarkers(guardConfig);
      const telemetryEnabled = isTelemetryEnabled(guardConfig);
      const telemetryPath = resolveTelemetryPath(guardConfig);

      const resolvePromptTarget = (
        outcome: PromptOutcome,
      ): { targetKey: DecisionTargetKey; source: DecisionSource; feedback: string | null } => {
        if (outcome.decision.kind === "proceed") {
          return { targetKey: "safe_auto_allow", source: "user_proceed", feedback: null };
        }
        if (outcome.decision.kind === "feedback") {
          return {
            targetKey: "hard_deny",
            source: "user_feedback",
            feedback: outcome.decision.feedback || null,
          };
        }
        if (outcome.decision.kind === "headless") {
          return { targetKey: "ask_confirmation", source: "headless_block", feedback: null };
        }
        return { targetKey: "ask_confirmation", source: "user_cancel", feedback: null };
      };

      if (CRITICAL_DANGER_REGEX.test(content)) {
        const audit = getCriticalDangerAudit(content);
        const outcome = await promptUserDetailed(ctx, content, audit, language);
        if (telemetryEnabled) {
          const resolved = resolvePromptTarget(outcome);
          logGuardDecision(
            createDecisionRecord({
              command: content,
              language,
              cwd: ctx?.cwd,
              markers,
              modelVerdict: {
                safe: false,
                action: audit.action,
                reason: audit.reason,
              },
              targetKey: resolved.targetKey,
              source: resolved.source,
              feedback: resolved.feedback,
              latencyMs: Date.now() - startTime,
            }),
            telemetryPath,
          );
        }
        return outcome.blockResult;
      }

      if (isAllowlistedCommand(content, guardConfig)) {
        if (telemetryEnabled) {
          logGuardDecision(
            createDecisionRecord({
              command: content,
              language,
              cwd: ctx?.cwd,
              markers,
              targetKey: "safe_auto_allow",
              source: "allowlist",
              latencyMs: Date.now() - startTime,
            }),
            telemetryPath,
          );
        }
        return;
      }

      const guard = await resolveGuardCandidates(ctx);
      if ("block" in guard) {
        const outcome = await promptUserDetailed(ctx, content, guard.reason, language);
        if (telemetryEnabled) {
          const resolved = resolvePromptTarget(outcome);
          logGuardDecision(
            createDecisionRecord({
              command: content,
              language,
              cwd: ctx?.cwd,
              markers,
              modelVerdict: {
                safe: false,
                reason: guard.reason,
              },
              targetKey: resolved.targetKey,
              source: resolved.source,
              feedback: resolved.feedback,
              latencyMs: Date.now() - startTime,
            }),
            telemetryPath,
          );
        }
        return outcome.blockResult;
      }

      const verdict = await evaluateCommandSafetyWithFallback(
        guard,
        content,
        language,
        undefined,
        ctx?.cwd,
        guardConfig,
      );
      if (!verdict.safe) {
        const audit = {
          action: verdict.action,
          reason:
            verdict.reason ||
            (language === "bash"
              ? "Action modifies state, cloud resources, or data."
              : "Script executes processes, modifies state, or mutates data."),
        };
        const outcome = await promptUserDetailed(ctx, content, audit, language);
        if (telemetryEnabled) {
          const resolved = resolvePromptTarget(outcome);
          logGuardDecision(
            createDecisionRecord({
              command: content,
              language,
              cwd: ctx?.cwd,
              markers,
              modelVerdict: {
                model: verdict.model,
                safe: false,
                action: verdict.action,
                reason: verdict.reason,
                raw: verdict.rawAnswers,
              },
              targetKey: resolved.targetKey,
              source: resolved.source,
              feedback: resolved.feedback,
              latencyMs: Date.now() - startTime,
            }),
            telemetryPath,
          );
        }
        return outcome.blockResult;
      }

      if (telemetryEnabled) {
        logGuardDecision(
          createDecisionRecord({
            command: content,
            language,
            cwd: ctx?.cwd,
            markers,
            modelVerdict: {
              model: verdict.model,
              safe: true,
              action: verdict.action,
              reason: verdict.reason,
              raw: verdict.rawAnswers,
            },
            targetKey: "safe_auto_allow",
            source: "model_safe",
            latencyMs: Date.now() - startTime,
          }),
          telemetryPath,
        );
      }
    },
  );
}
