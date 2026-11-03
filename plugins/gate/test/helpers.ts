import type { Exec, ExecResult } from "../src/types";

export type Handler = (cmd: string, args: string[]) => Partial<ExecResult> | undefined;

/** An exec that answers from `handler`, defaulting to a successful empty result. */
export function fakeExec(handler: Handler): { exec: Exec; calls: string[]; cwds: string[] } {
  const calls: string[] = [];
  const cwds: string[] = [];
  const exec: Exec = async (cmd, args, options) => {
    calls.push([cmd, ...args].join(" "));
    cwds.push(options?.cwd ?? "");
    return { stdout: "", stderr: "", code: 0, killed: false, ...handler(cmd, args) };
  };
  return { exec, calls, cwds };
}

export const NOT_FOUND: Partial<ExecResult> = { code: 127 };
