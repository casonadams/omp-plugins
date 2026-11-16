import { opendir } from "node:fs/promises";
import path from "node:path";

export interface RepoInventory {
  scanMode: "standard" | "large";
  totalFiles: number;
  sourceFiles: number;
  truncated: boolean;
  unreadableDirs: number;
  languages: string[];
  packageFiles: string[];
  buildFiles: string[];
  testFiles: string[];
  topLevelDirs: string[];
  /** Reviewable files per directory, keyed by repo-relative path (`.` is the root). */
  fileDirs: Record<string, number>;
}

export interface InventoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface Limits {
  maxDirs: number;
  maxEntries: number;
  largeTotalFiles: number;
  largeSourceFiles: number;
}

export interface InventoryOptions {
  readDirectory?: (dir: string) => AsyncIterable<InventoryEntry>;
  limits?: Partial<Limits>;
}

const IGNORED_DIRS = new Set([
  ".git",
  ".gradle",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
]);
const PACKAGE_FILES = new Set([
  "build.gradle",
  "build.gradle.kts",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "go.mod",
  "Package.swift",
  "package.json",
  "pom.xml",
  "pyproject.toml",
]);
const BUILD_FILES = new Set([
  "CMakeLists.txt",
  "Dockerfile",
  "Makefile",
  "meson.build",
  "tsconfig.json",
  "vite.config.ts",
  "webpack.config.js",
]);
const LANGUAGES: Record<string, string> = {
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".dart": "Dart",
  ".go": "Go",
  ".h": "C/C++",
  ".hpp": "C++",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scala": "Scala",
  ".sh": "Shell",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
};
const TEST_FILE = /(^|[\\/])(test|tests|__tests__|spec)([\\/]|$)|\.(test|spec)\.[^.]+$/;

export const DEFAULT_LIMITS: Limits = {
  maxDirs: 10_000,
  maxEntries: 50_000,
  largeTotalFiles: 5_000,
  largeSourceFiles: 2_000,
};
const NON_CODE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".wav",
  ".zip",
  ".gz",
  ".tgz",
  ".tar",
  ".7z",
  ".pdf",
  ".bin",
  ".lock",
  ".map",
  ".md",
  ".mdx",
  ".txt",
  ".rst",
]);
const BATCH = 16;
const LIST_CAP = 25;

interface Tally {
  totalFiles: number;
  sourceFiles: number;
  entries: number;
  truncated: boolean;
  unreadableDirs: number;
  languages: Set<string>;
  packageFiles: Set<string>;
  buildFiles: Set<string>;
  testFiles: Set<string>;
  topLevelDirs: Set<string>;
  fileDirs: Map<string, number>;
}

export async function discoverRepoInventory(
  root: string,
  options: InventoryOptions = {},
): Promise<RepoInventory> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const read = options.readDirectory ?? streamDirectory;
  const tally: Tally = {
    totalFiles: 0,
    sourceFiles: 0,
    entries: 0,
    truncated: false,
    unreadableDirs: 0,
    languages: new Set(),
    packageFiles: new Set(),
    buildFiles: new Set(),
    testFiles: new Set(),
    topLevelDirs: new Set(),
    fileDirs: new Map(),
  };
  let level = [root];
  let visitedDirs = 0;
  while (level.length > 0 && !tally.truncated) {
    const next: string[] = [];
    for (let i = 0; i < level.length && !tally.truncated; i += BATCH) {
      const wanted = level.slice(i, i + BATCH);
      const batch = wanted.slice(0, Math.max(limits.maxDirs - visitedDirs, 0));
      tally.truncated = batch.length < wanted.length;
      visitedDirs += batch.length;
      await Promise.all(batch.map((dir) => visit({ root, dir, next, tally, read, limits })));
    }
    level = next;
  }
  return toInventory(tally, limits);
}

async function* streamDirectory(dir: string): AsyncIterable<InventoryEntry> {
  yield* await opendir(dir);
}

interface Visit {
  root: string;
  dir: string;
  next: string[];
  tally: Tally;
  read: (dir: string) => AsyncIterable<InventoryEntry>;
  limits: Limits;
}

async function visit({ root, dir, next, tally, read, limits }: Visit): Promise<void> {
  try {
    for await (const entry of read(dir)) {
      if (++tally.entries > limits.maxEntries) {
        tally.truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (dir === root) tally.topLevelDirs.add(entry.name);
        next.push(absolute);
      } else if (entry.isFile()) {
        recordFile(tally, path.relative(root, absolute));
      }
    }
  } catch {
    tally.unreadableDirs++;
  }
}

function recordFile(tally: Tally, relative: string): void {
  tally.totalFiles++;
  const base = path.basename(relative);
  const extension = path.extname(base).toLowerCase();
  if (PACKAGE_FILES.has(base)) tally.packageFiles.add(relative);
  if (BUILD_FILES.has(base)) tally.buildFiles.add(relative);
  if (TEST_FILE.test(relative)) tally.testFiles.add(relative);
  const language = LANGUAGES[extension];
  if (language !== undefined) {
    tally.languages.add(language);
    tally.sourceFiles++;
  }
  if (NON_CODE_EXTENSIONS.has(extension)) return;
  const dir = path.dirname(relative).split(path.sep).join("/");
  tally.fileDirs.set(dir, (tally.fileDirs.get(dir) ?? 0) + 1);
}

function toInventory(tally: Tally, limits: Limits): RepoInventory {
  const large =
    tally.truncated ||
    tally.totalFiles > limits.largeTotalFiles ||
    tally.sourceFiles > limits.largeSourceFiles;
  return {
    scanMode: large ? "large" : "standard",
    totalFiles: tally.totalFiles,
    sourceFiles: tally.sourceFiles,
    truncated: tally.truncated,
    unreadableDirs: tally.unreadableDirs,
    languages: sorted(tally.languages),
    packageFiles: sorted(tally.packageFiles),
    buildFiles: sorted(tally.buildFiles),
    testFiles: sorted(tally.testFiles).slice(0, LIST_CAP),
    topLevelDirs: sorted(tally.topLevelDirs),
    fileDirs: Object.fromEntries([...tally.fileDirs].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}
