function attr(text: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(text)?.[1];
}

/** A contract that changed with callers that no longer fit. `unchanged` never counts: ripwire
 * counts a method's receiver as an argument and reports mismatches even when nothing changed. */
export function brokenContract(editCheck: string): { status: string; callers: number } | undefined {
  const status = attr(editCheck, "status");
  const callers = Number(attr(editCheck, "incompatible") ?? 0);
  if (!status || status === "unchanged" || callers === 0) return undefined;
  return { status, callers };
}

export function gatingRows(qualityDelta: string): string[] {
  const rows = qualityDelta.match(/<r [^>]*gating="1"[^>]*>/g) ?? [];
  return rows.map((row) => row.replace(/ (next|origin)="[^"]*"/g, ""));
}

export function untestedRows(testGate: string): string[] {
  const rows = [...testGate.matchAll(/<u sym="([^"]*)" p="([^"]*)" l="(\d*)"/g)];
  return rows.map((m) => `${m[1]} (${m[2]}:${m[3]})`);
}

export function partnerFiles(situ: string): string[] {
  return [...situ.matchAll(/<partner path="([^"]*)"/g)].map((m) => m[1]);
}
