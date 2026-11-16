import { describe, expect, test } from "bun:test";
import { completions, parseArgs } from "../src/args";
import { profileList } from "../src/profiles";

describe("parseArgs", () => {
  test.each([
    ["", { kind: "help" }],
    ["help", { kind: "help" }],
    ["--help", { kind: "help" }],
    ["review", { kind: "scan", profile: "review" }],
    ["  architecture ", { kind: "scan", profile: "architecture" }],
  ])("%j", (input, expected) => {
    expect(parseArgs(input)).toEqual(expected as ReturnType<typeof parseArgs>);
  });

  test.each([
    ["help extra", "Unexpected argument: extra"],
    ["review security", "Unexpected argument: security"],
    ["scan", "Unknown profile: scan"],
    ["scan --profile security", "Unexpected argument: --profile"],
    ["nope", "Unknown profile: nope"],
    ["Security", "Unknown profile: Security"],
  ])("rejects %j", (input, message) => {
    expect(parseArgs(input)).toEqual({ kind: "error", message });
  });
});

describe("completions", () => {
  test("offers every profile with a description, then help, for an empty prefix", () => {
    const items = completions("") ?? [];

    expect(items.map((item) => item.value)).toEqual([...profileList(), "help"]);
    expect(items.every((item) => item.description)).toBe(true);
  });

  test("filters by prefix and returns null when nothing matches", () => {
    expect(completions("per")?.map((item) => item.value)).toEqual(["performance"]);
    expect(completions("zzz")).toBeNull();
  });
});
