import { describe, expect, test } from "bun:test";
import { addedSymbols } from "../src/symbols";

describe("addedSymbols", () => {
  test("reads public declarations of each language from added lines only", () => {
    const diff = [
      "+pub async fn run(x: u8) {}",
      "+    pub(crate) struct Inner;",
      "-pub fn removed() {}",
      "+fn private() {}",
      "+export default async function boot() {}",
      "+export interface Opts {}",
      "+def handler(a):",
      "+def _hidden():",
      "+func (s *S) Serve() {}",
      "+func helper() {}",
    ].join("\n");
    expect(addedSymbols(diff)).toEqual(["run", "Inner", "boot", "Opts", "handler", "Serve"]);
  });

  test("lists a symbol once", () => {
    expect(addedSymbols("+pub fn a() {}\n+pub fn a() {}")).toEqual(["a"]);
  });
});
