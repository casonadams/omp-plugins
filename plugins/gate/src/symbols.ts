/** One pattern per language family; group 1 is the symbol name. */
const DECLARATIONS: RegExp[] = [
  /^\+\s*pub(?:\([a-z]+\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static)\s+([A-Za-z_]\w*)/,
  /^\+\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\+(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/,
  /^\+func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/,
];

/** Public symbols declared on the added lines of a `git diff -U0` text, unique, in order. */
export function addedSymbols(diff: string): string[] {
  const seen = new Set<string>();
  for (const line of diff.split("\n")) {
    for (const pattern of DECLARATIONS) {
      const name = pattern.exec(line)?.[1];
      if (name) seen.add(name);
    }
  }
  return [...seen];
}
