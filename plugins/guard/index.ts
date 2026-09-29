import { CRITICAL_DANGER_REGEX, getCriticalDangerAudit } from "./src/constants";
import { evaluateCommandSafety, resolveGuardModel } from "./src/guard-model";
import type { BlockResult, ExtensionContext, PiExtensionAPI, ToolCallEvent } from "./src/types";
import { promptUser } from "./src/ui";

export {
  CRITICAL_DANGER_REGEX,
  GUARD_SYSTEM_PROMPT,
  getCriticalDangerAudit,
} from "./src/constants";
export {
  evaluateCommandSafety,
  evaluateSystemOneSafety,
  getConfiguredModelRole,
  isDecisionModel,
  isKeylessModel,
  parseGuardOutput,
  parseSystemOneOutput,
  resolveGuardModel,
} from "./src/guard-model";
export { isAllowlistedCommand, loadGuardConfig, resolveProductionMarkers } from "./src/config";
export type * from "./src/types";
export { promptUser } from "./src/ui";

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

      if (CRITICAL_DANGER_REGEX.test(content)) {
        return promptUser(ctx, content, getCriticalDangerAudit(content), language);
      }

      const guard = await resolveGuardModel(ctx);
      if ("block" in guard) {
        return promptUser(ctx, content, guard.reason, language);
      }

      const verdict = await evaluateCommandSafety(
        guard.model,
        guard.apiKey,
        content,
        language,
        undefined,
        ctx?.cwd,
      );
      if (!verdict.safe) {
        return promptUser(
          ctx,
          content,
          {
            action: verdict.action,
            reason:
              verdict.reason ||
              (language === "bash"
                ? "Action modifies state, cloud resources, or data."
                : "Script executes processes, modifies state, or mutates data."),
          },
          language,
        );
      }
    },
  );
}
