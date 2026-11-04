/** One pattern per language family; group 1 is the symbol name. */
const DECLARATIONS: RegExp[] = [
  /^\+\s*pub(?:\([a-z]+\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static)\s+([A-Za-z_]\w*)/,
  /^\+\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\+(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/,
  /^\+func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/,
  /^\+\s*(?:(?:abstract|sealed|base|final|interface)\s+)*(?:class|mixin|enum|extension(?:\s+type)?|typedef)\s+([A-Za-z]\w*)/,
  /^\+\s*(?:(?:external|static)\s+)*(?!(?:return|throw|await|case|yield|assert|if|while|switch|for|catch|else|finally|break|continue|default|rethrow|fn|func|function|var|let|const|pub|import|export|part|library)\b)(?:void|[A-Za-z]\w*(?:<[^;{()]+>)?\??\s+)?(?:get\s+|set\s+)?([A-Za-z]\w*)\s*\(/,
  /^\+\s*(?:(?:external|static)\s+)*(?!(?:return|throw|await|case|yield|assert|if|while|switch|for|catch|else|finally|break|continue|default|rethrow|fn|func|function|var|let|const|pub|import|export|part|library)\b)(?:void|[A-Za-z]\w*(?:<[^;{()]+>)?\??\s+)?get\s+([A-Za-z]\w*)\b/,
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
