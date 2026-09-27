import { CRITICAL_DANGER_REGEX } from "./src/constants";
import { evaluateCommandSafety, resolveGuardModel } from "./src/guard-model";
import type { BlockResult, ExtensionContext, PiExtensionAPI, ToolCallEvent } from "./src/types";
import { promptUser } from "./src/ui";

export { CRITICAL_DANGER_REGEX, GUARD_SYSTEM_PROMPT } from "./src/constants";
export { evaluateCommandSafety, parseGuardOutput, resolveGuardModel } from "./src/guard-model";
export type * from "./src/types";
export { promptUser } from "./src/ui";

export default function registerBashGuard(pi: PiExtensionAPI) {
  pi.on(
    "tool_call",
    async (event: ToolCallEvent, ctx?: ExtensionContext): Promise<BlockResult | void> => {
      if (event.toolName !== "bash") return;

      const command =
        typeof event.input?.command === "string" ? event.input.command.trim() : undefined;
      if (!command) return;

      if (CRITICAL_DANGER_REGEX.test(command)) {
        return promptUser(
          ctx,
          command,
          "Critical destructive or irreversible infrastructure action detected.",
        );
      }

      const guard = await resolveGuardModel(ctx);
      if ("block" in guard) {
        return promptUser(ctx, command, guard.reason);
      }

      const verdict = await evaluateCommandSafety(guard.model, guard.apiKey, command);
      if (!verdict.safe) {
        return promptUser(
          ctx,
          command,
          verdict.reason || "Action modifies state, cloud resources, or data.",
        );
      }
    },
  );
}
