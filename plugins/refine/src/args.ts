import { isProfile, profileList, profiles, type Profile } from "./profiles";
import type { CompletionItem } from "./types";

export type Request =
  { kind: "help" } | { kind: "scan"; profile: Profile } | { kind: "error"; message: string };

export function usage(): string {
  return `Usage: /refine <profile>\nProfiles: ${profileList().join(", ")}\n/refine help shows this message.`;
}

export function parseArgs(input: string): Request {
  const [word, ...rest] = input.trim().split(/\s+/).filter(Boolean);
  if (rest.length > 0) return error(`Unexpected argument: ${rest[0]}`);
  if (word === undefined || word === "help" || word === "--help") return { kind: "help" };
  if (!isProfile(word)) return error(`Unknown profile: ${word}`);
  return { kind: "scan", profile: word };
}

function error(message: string): Request {
  return { kind: "error", message };
}

export function completions(prefix: string): CompletionItem[] | null {
  const items: CompletionItem[] = [
    ...profileList().map((profile) => ({
      value: profile,
      label: profile,
      description: profiles[profile].summary,
    })),
    { value: "help", label: "help", description: "Show usage" },
  ];
  const matches = items.filter((item) => item.value.startsWith(prefix));
  return matches.length > 0 ? matches : null;
}
