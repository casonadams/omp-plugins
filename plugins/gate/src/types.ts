export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

export type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<ExecResult>;

export interface GateContext {
  cwd: string;
  hasUI?: boolean;
  ui?: { notify(message: string, type?: string): void };
}

export interface ToolCallEvent {
  toolName: string;
  input?: Record<string, unknown>;
}

export interface SessionStopEvent {
  last_assistant_message?: unknown;
}

export interface PiExtensionAPI {
  exec: Exec;
  // Handlers are typed loosely here: omp's own event types are a superset of these fields.
  on(event: string, handler: (event: never, ctx: GateContext) => unknown): void;
}

export interface GateReport {
  ok: boolean;
  lines: string[];
}
