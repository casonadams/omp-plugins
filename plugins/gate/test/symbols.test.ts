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
      "+class Service {}",
      "+abstract class BaseRepo<T> {}",
      "+mixin Logging {}",
      "+enum Direction { north, south }",
      "+extension StrExt on String {}",
      "+typedef Predicate<T> = bool Function(T);",
      "+void main() {}",
      "+Future<List<String>> fetchItems() async {}",
      "+String get title => _title;",
      "+set count(int v) {}",
      "+class _PrivateWidget {}",
      "+void _internalHelper() {}",
      "+int _hiddenCount = 0;",
      "+    return print(123);",
      "+    if (isValid()) {",
    ].join("\n");
    expect(addedSymbols(diff)).toEqual([
      "run",
      "Inner",
      "boot",
      "Opts",
      "handler",
      "Serve",
      "Service",
      "BaseRepo",
      "Logging",
      "Direction",
      "StrExt",
      "Predicate",
      "main",
      "fetchItems",
      "title",
      "count",
    ]);
  });

  test("lists a symbol once", () => {
    expect(addedSymbols("+pub fn a() {}\n+pub fn a() {}")).toEqual(["a"]);
  });
});
