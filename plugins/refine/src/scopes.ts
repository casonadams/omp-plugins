export interface Scope {
  /** `dir` is the whole subtree, `dir/*` only files directly in `dir`, `.` the repo root. */
  paths: string[];
  files: number;
}

export const MAX_SCOPES = { standard: 3, large: 5 } as const;

const MIN_SCOPE_FILES = 40;

interface Node {
  path: string;
  own: number;
  total: number;
  children: Map<string, Node>;
}

/** Splits reviewable files into at most `maxScopes` disjoint slices of roughly equal size. */
export function planScopes(dirs: Record<string, number>, maxScopes: number): Scope[] {
  const root = buildTree(dirs);
  const target = Math.max(MIN_SCOPE_FILES, Math.ceil(root.total / maxScopes));
  const scopes = collect(root, target);
  while (scopes.length > maxScopes) mergeSmallest(scopes);
  return scopes.sort(bySize);
}

function collect(node: Node, target: number): Scope[] {
  if (node.total <= target || node.children.size === 0) return [whole(node)];
  const scopes: Scope[] = [];
  const small: Scope[] = [];
  for (const child of node.children.values()) {
    if (child.total > target) scopes.push(...collect(child, target));
    else small.push(whole(child));
  }
  if (node.own > 0) {
    const direct = { paths: [node.path === "." ? "./*" : `${node.path}/*`], files: node.own };
    (direct.files > target ? scopes : small).push(direct);
  }
  return [...scopes, ...pack(small, target)];
}

function pack(pieces: Scope[], target: number): Scope[] {
  const bins: Scope[] = [];
  for (const piece of pieces.sort(bySize)) {
    const bin = bins.find((candidate) => candidate.files + piece.files <= target);
    if (bin) {
      bin.paths.push(...piece.paths);
      bin.files += piece.files;
    } else {
      bins.push({ paths: [...piece.paths], files: piece.files });
    }
  }
  return bins;
}

function mergeSmallest(scopes: Scope[]): void {
  scopes.sort((a, b) => bySize(b, a));
  const [first, second] = scopes.splice(0, 2);
  scopes.push({ paths: [...first.paths, ...second.paths], files: first.files + second.files });
}

function whole(node: Node): Scope {
  return { paths: [node.path], files: node.total };
}

function bySize(a: Scope, b: Scope): number {
  return b.files - a.files || a.paths[0].localeCompare(b.paths[0]);
}

function buildTree(dirs: Record<string, number>): Node {
  const root: Node = { path: ".", own: 0, total: 0, children: new Map() };
  for (const [dir, count] of Object.entries(dirs)) {
    let node = root;
    node.total += count;
    for (const segment of dir === "." ? [] : dir.split("/")) {
      const path = node.path === "." ? segment : `${node.path}/${segment}`;
      const child = node.children.get(segment) ?? { path, own: 0, total: 0, children: new Map() };
      node.children.set(segment, child);
      node = child;
      node.total += count;
    }
    node.own += count;
  }
  return root;
}
