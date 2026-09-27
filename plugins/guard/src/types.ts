import type { Api, Model } from "@oh-my-pi/pi-ai";

export interface ToolCallEvent {
  toolName: string;
  input?: Record<string, unknown>;
}

export interface BlockResult {
  block: boolean;
  reason: string;
}

export interface ExtensionUIContext {
  select?(
    title: string,
    options: string[] | { label: string; description?: string }[],
    optionsConfig?: { initialIndex?: number; signal?: AbortSignal },
  ): Promise<string | undefined>;
  input?(
    title: string,
    placeholder?: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | undefined>;
  askDialog?(
    questions: Array<{
      id: string;
      header?: string;
      question: string;
      recommended?: number;
      options: Array<{ label: string; description?: string; preview?: string }>;
    }>,
  ): Promise<
    | { kind: string; results: Array<{ selectedOptions: string[]; customInput?: string }> }
    | undefined
  >;
  editor?(
    title: string,
    prefill?: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | undefined>;
  confirm?(title: string, message: string, options?: { signal?: AbortSignal }): Promise<boolean>;
  notify?(message: string, level?: "info" | "warning" | "error"): void;
}

export interface ExtensionContext {
  hasUI?: boolean;
  ui?: ExtensionUIContext;
  models?: {
    resolve(spec: string): Model<Api> | undefined;
  };
  modelRegistry?: {
    getApiKey(model: Model<Api>): Promise<string | undefined>;
  };
}

export interface PiExtensionAPI {
  on(
    event: "tool_call",
    handler: (event: ToolCallEvent, ctx?: ExtensionContext) => Promise<BlockResult | void>,
  ): void;
}
