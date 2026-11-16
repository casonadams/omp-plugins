import { describe, expect, test } from "bun:test";
import { planScopes, type Scope } from "../src/scopes";

const total = (dirs: Record<string, number>) => Object.values(dirs).reduce((a, b) => a + b, 0);
const sum = (scopes: Scope[]) => scopes.reduce((acc, scope) => acc + scope.files, 0);

describe("planScopes", () => {
  test("a repo with no source files is one root scope", () => {
    expect(planScopes({}, 3)).toEqual([{ paths: ["."], files: 0 }]);
  });

  test("a repo at or under the minimum scope size is not split", () => {
    expect(planScopes({ a: 15, b: 15, c: 10 }, 3)).toEqual([{ paths: ["."], files: 40 }]);
  });

  test("a single-child chain collapses to the directories that actually split", () => {
    expect(planScopes({ "src/app/x": 100, "src/app/y": 80 }, 2)).toEqual([
      { paths: ["src/app/x"], files: 100 },
      { paths: ["src/app/y"], files: 80 },
    ]);
  });

  test("files directly in a directory become their own `dir/*` scope", () => {
    expect(planScopes({ ".": 30, a: 40, b: 50 }, 3)).toEqual([
      { paths: ["b"], files: 50 },
      { paths: ["a"], files: 40 },
      { paths: ["./*"], files: 30 },
    ]);
  });

  test("a flat directory of many small subdirectories is packed into balanced scopes", () => {
    const dirs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/d${i}`, 10]));

    const scopes = planScopes(dirs, 3);

    expect(scopes.map((scope) => scope.files)).toEqual([100, 100, 100]);
  });

  test("scopes beyond the limit are merged smallest-first", () => {
    const dirs = { "plugins/a/src": 60, "plugins/b/src": 50, "plugins/c": 45, scripts: 5, ".": 2 };

    expect(planScopes(dirs, 3)).toEqual([
      { paths: ["plugins/a/src"], files: 60 },
      { paths: ["scripts", "./*", "plugins/c"], files: 52 },
      { paths: ["plugins/b"], files: 50 },
    ]);
  });

  test.each([
    ["flat", { ".": 500 }, 5],
    ["wide", Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`d${i}`, 25 + i])), 5],
    ["deep", { "a/b/c/d": 90, "a/b/e": 70, "a/f": 60, g: 30, ".": 25 }, 3],
    ["lopsided", { big: 5000, small: 21, tiny: 3 }, 4],
  ])(
    "%s layout: every source file lands in exactly one scope within the limit",
    (_name, dirs, max) => {
      const scopes = planScopes(dirs, max);

      expect(sum(scopes)).toBe(total(dirs));
      expect(scopes.length).toBeLessThanOrEqual(max);
      const paths = scopes.flatMap((scope) => scope.paths);
      expect(new Set(paths).size).toBe(paths.length);
    },
  );

  test("is deterministic regardless of input key order", () => {
    const forward = { a: 50, b: 40, c: 30, d: 25 };
    const reversed = { d: 25, c: 30, b: 40, a: 50 };

    expect(planScopes(reversed, 3)).toEqual(planScopes(forward, 3));
  });
});
