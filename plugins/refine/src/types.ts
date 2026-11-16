export interface RefineContext {
  cwd: string;
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export interface RefineAPI {
  registerCommand(
    name: string,
    options: {
      description: string;
      getArgumentCompletions: (prefix: string) => CompletionItem[] | null;
      handler: (args: string, ctx: RefineContext) => Promise<void>;
    },
  ): void;
  sendMessage(
    message: { customType: string; content: string; display: boolean },
    options: { triggerTurn: boolean },
  ): void;
}
