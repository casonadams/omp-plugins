import { describe, expect, test } from "bun:test";
import { brokenContract, gatingRows, partnerFiles, untestedRows } from "../src/parse";

describe("ripwire output", () => {
  test("a changed contract with callers that no longer fit is broken", () => {
    expect(brokenContract('<edit-check status="contract-change" incompatible="2">')).toEqual({
      status: "contract-change",
      callers: 2,
    });
  });

  test("unchanged is never broken, whatever it says about callers", () => {
    expect(brokenContract('<edit-check status="unchanged" incompatible="2">')).toBeUndefined();
    expect(
      brokenContract('<edit-check status="contract-change" incompatible="0">'),
    ).toBeUndefined();
    expect(brokenContract("no attributes")).toBeUndefined();
  });

  test("only gating quality rows are returned, without their hints", () => {
    const xml = '<r kind="a" gating="1" next="--x"/><r kind="b" gating="0"/>';
    expect(gatingRows(xml)).toEqual(['<r kind="a" gating="1"/>']);
  });

  test("untested rows and co-change partners", () => {
    expect(untestedRows('<u sym="f" p="src/a.rs" l="4" ccx="2"/>')).toEqual(["f (src/a.rs:4)"]);
    expect(partnerFiles('<partner path="docs/X.md (36%)"/>')).toEqual(["docs/X.md (36%)"]);
  });
});
