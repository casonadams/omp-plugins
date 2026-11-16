import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discoverRepoInventory,
  type InventoryEntry,
  type InventoryOptions,
} from "../src/inventory";
import { planScopes } from "../src/scopes";

const roots: string[] = [];

async function repo(files: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "refine-"));
  roots.push(root);
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverRepoInventory", () => {
  test("summarizes repo shape and skips ignored directories", async () => {
    const root = await repo([
      "package.json",
      "tsconfig.json",
      "src/index.ts",
      "src/index.test.ts",
      "src/util.py",
      "node_modules/dep/ignored.ts",
      "dist/out.js",
    ]);

    const inventory = await discoverRepoInventory(root);

    expect(inventory).toMatchObject({
      scanMode: "standard",
      totalFiles: 5,
      sourceFiles: 3,
      truncated: false,
      unreadableDirs: 0,
      languages: ["Python", "TypeScript"],
      packageFiles: ["package.json"],
      buildFiles: ["tsconfig.json"],
      testFiles: [path.join("src", "index.test.ts")],
      topLevelDirs: ["src"],
      fileDirs: { ".": 2, src: 3 },
    });
  });

  test("does not follow symlinks", async () => {
    const root = await repo(["a/real.ts"]);
    await symlink(path.join(root, "a"), path.join(root, "link"));

    const inventory = await discoverRepoInventory(root);

    expect(inventory.totalFiles).toBe(1);
    expect(inventory.topLevelDirs).toEqual(["a"]);
  });

  test("counts an unreadable root instead of throwing", async () => {
    const inventory = await discoverRepoInventory(path.join(tmpdir(), "refine-does-not-exist"));

    expect(inventory.unreadableDirs).toBe(1);
    expect(inventory.totalFiles).toBe(0);
  });
});

const file = (name: string): InventoryEntry => entry(name, "file");
const dir = (name: string): InventoryEntry => entry(name, "dir");

function entry(name: string, kind: "file" | "dir"): InventoryEntry {
  return {
    name,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
    isSymbolicLink: () => false,
  };
}

function fakeTree(tree: Record<string, InventoryEntry[]>, reads: string[] = []) {
  const readDirectory: NonNullable<InventoryOptions["readDirectory"]> = async function* (path) {
    reads.push(path);
    const entries = tree[path];
    if (!entries) throw new Error("EACCES");
    yield* entries;
  };
  return readDirectory;
}

const files = (count: number, ext = ".ts") =>
  Array.from({ length: count }, (_, i) => file(`f${i}${ext}`));

describe("discoverRepoInventory limits and modes", () => {
  test("an empty repo is standard with nothing recorded", async () => {
    const inventory = await discoverRepoInventory("/r", { readDirectory: fakeTree({ "/r": [] }) });

    expect(inventory).toMatchObject({
      scanMode: "standard",
      totalFiles: 0,
      sourceFiles: 0,
      truncated: false,
      languages: [],
      fileDirs: {},
    });
  });

  test("the source-file threshold is inclusive of the limit and large above it", async () => {
    const readDirectory = fakeTree({ "/r": files(4) });

    const atLimit = await discoverRepoInventory("/r", {
      readDirectory,
      limits: { largeSourceFiles: 4 },
    });
    const above = await discoverRepoInventory("/r", {
      readDirectory,
      limits: { largeSourceFiles: 3 },
    });

    expect(atLimit.scanMode).toBe("standard");
    expect(above.scanMode).toBe("large");
  });

  test("the total-file threshold makes a repo large even without recognized source", async () => {
    const readDirectory = fakeTree({ "/r": files(6, ".weird") });

    const inventory = await discoverRepoInventory("/r", {
      readDirectory,
      limits: { largeTotalFiles: 5 },
    });

    expect(inventory).toMatchObject({ scanMode: "large", sourceFiles: 0, totalFiles: 6 });
  });

  test("the entry cap truncates, forces large mode, and stops reading the directory stream", async () => {
    let pulled = 0;
    const readDirectory: NonNullable<InventoryOptions["readDirectory"]> = async function* () {
      for (let i = 0; i < 1000; i++) {
        pulled++;
        yield file(`f${i}.ts`);
      }
    };

    const inventory = await discoverRepoInventory("/r", {
      readDirectory,
      limits: { maxEntries: 5 },
    });

    expect(inventory).toMatchObject({ truncated: true, scanMode: "large", totalFiles: 5 });
    expect(pulled).toBeLessThanOrEqual(6);
  });

  test("the directory cap truncates and bounds how many directories are read", async () => {
    const reads: string[] = [];
    const tree: Record<string, InventoryEntry[]> = {
      "/r": Array.from({ length: 6 }, (_, i) => dir(`d${i}`)),
    };
    for (let i = 0; i < 6; i++) tree[`/r/d${i}`] = [file("a.ts")];

    const inventory = await discoverRepoInventory("/r", {
      readDirectory: fakeTree(tree, reads),
      limits: { maxDirs: 3 },
    });

    expect(inventory.truncated).toBe(true);
    expect(reads).toHaveLength(3);
  });

  test("an unreadable directory is counted and the rest of the tree is still inventoried", async () => {
    const readDirectory = fakeTree({
      "/r": [dir("locked"), dir("open"), file("top.ts")],
      "/r/open": [file("a.ts")],
    });

    const inventory = await discoverRepoInventory("/r", { readDirectory });

    expect(inventory).toMatchObject({
      unreadableDirs: 1,
      totalFiles: 2,
      sourceFiles: 2,
      truncated: false,
    });
  });
});

describe("discoverRepoInventory reviewable files", () => {
  test("recognizes Kotlin scripts", async () => {
    const inventory = await discoverRepoInventory("/r", {
      readDirectory: fakeTree({ "/r": [file("build.gradle.kts")] }),
    });

    expect(inventory.languages).toEqual(["Kotlin"]);
  });

  test("unrecognized languages are sized for scopes, while assets and docs are not", async () => {
    const readDirectory = fakeTree({
      "/r": [dir("lib"), dir("assets"), file("README.md"), file("app.vue")],
      "/r/lib": Array.from({ length: 3 }, (_, i) => dir(`m${i}`)),
      "/r/lib/m0": files(40, ".lua"),
      "/r/lib/m1": files(40, ".lua"),
      "/r/lib/m2": files(40, ".lua"),
      "/r/assets": files(500, ".png"),
    });

    const inventory = await discoverRepoInventory("/r", { readDirectory });

    expect(inventory.sourceFiles).toBe(0);
    expect(inventory.totalFiles).toBe(622);
    expect(inventory.fileDirs).toEqual({ ".": 1, "lib/m0": 40, "lib/m1": 40, "lib/m2": 40 });
    expect(planScopes(inventory.fileDirs, 3).map((scope) => scope.files)).toEqual([41, 40, 40]);
  });
});
