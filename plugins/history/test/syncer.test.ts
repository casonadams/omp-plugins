import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HistorySyncer } from "../src/syncer";
import type { ResolvedHistoryTarget } from "../src/types";

describe("HistorySyncer", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "history-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("hygiene filtering (shouldSync)", () => {
    test("rejects commands with leading spaces or tabs by default", () => {
      const syncer = new HistorySyncer();
      expect(syncer.shouldSync(" echo secret")).toBe(false);
      expect(syncer.shouldSync("\tcurl https://api.internal")).toBe(false);
      expect(syncer.shouldSync("echo public")).toBe(true);
    });

    test("allows leading whitespace when ignoreSpace is false", () => {
      const syncer = new HistorySyncer({ ignoreSpace: false });
      expect(syncer.shouldSync(" echo secret")).toBe(true);
      expect(syncer.shouldSync("\tgit status")).toBe(true);
    });

    test("rejects empty, whitespace-only, or invalid inputs", () => {
      const syncer = new HistorySyncer();
      expect(syncer.shouldSync("")).toBe(false);
      expect(syncer.shouldSync("   ")).toBe(false);
      expect(syncer.shouldSync("\n\t  ")).toBe(false);
      expect(syncer.shouldSync(null as unknown as string)).toBe(false);
      expect(syncer.shouldSync(undefined as unknown as string)).toBe(false);
    });

    test("rejects consecutive duplicate commands by default", () => {
      const syncer = new HistorySyncer();
      expect(syncer.shouldSync("ls -la")).toBe(true);
      syncer.recordSynced("ls -la");
      expect(syncer.shouldSync("ls -la")).toBe(false);
      expect(syncer.shouldSync("ls -la  ")).toBe(false);

      // Non-consecutive duplicate is allowed
      expect(syncer.shouldSync("pwd")).toBe(true);
      syncer.recordSynced("pwd");
      expect(syncer.shouldSync("ls -la")).toBe(true);
    });

    test("allows consecutive duplicates when ignoreDups is false", () => {
      const syncer = new HistorySyncer({ ignoreDups: false });
      expect(syncer.shouldSync("date")).toBe(true);
      syncer.recordSynced("date");
      expect(syncer.shouldSync("date")).toBe(true);
    });

    test("exposes last synced command via getLastCommand", () => {
      const syncer = new HistorySyncer();
      expect(syncer.getLastCommand()).toBeUndefined();
      syncer.recordSynced("  bun test  ");
      expect(syncer.getLastCommand()).toBe("bun test");
    });
  });

  describe("appendToHistory", () => {
    test("appends formatted entry and creates target directories recursively", async () => {
      const syncer = new HistorySyncer();
      const historyPath = path.join(tmpDir, "sub", "dir", ".zsh_history");
      const target: ResolvedHistoryTarget = {
        shellType: "zsh",
        historyPath,
        extendedHistory: true,
        appendTimestamp: false,
      };

      const success = await syncer.appendToHistory("echo test-write", target, 1700000000);
      expect(success).toBe(true);

      const content = await fs.readFile(historyPath, "utf8");
      expect(content).toBe(": 1700000000:0;echo test-write\n");

      // Verify file permissions mode 0o600 (read/write by owner only)
      const stats = await fs.stat(historyPath);
      // Mask file type bits (S_IFMT is 0o170000)
      expect(stats.mode & 0o777).toBe(0o600);
    });

    test("appends multiple entries in sequence", async () => {
      const syncer = new HistorySyncer();
      const historyPath = path.join(tmpDir, ".bash_history");
      const target: ResolvedHistoryTarget = {
        shellType: "bash",
        historyPath,
        extendedHistory: false,
        appendTimestamp: false,
      };

      await syncer.appendToHistory("first cmd", target);
      await syncer.appendToHistory("second cmd", target);

      const content = await fs.readFile(historyPath, "utf8");
      expect(content).toBe("first cmd\nsecond cmd\n");
    });

    test("returns false gracefully without throwing when filesystem fails", async () => {
      const syncer = new HistorySyncer();
      // Using an invalid path where a file is treated as a directory
      const filePath = path.join(tmpDir, "blocking-file");
      await fs.writeFile(filePath, "data");
      const target: ResolvedHistoryTarget = {
        shellType: "bash",
        historyPath: path.join(filePath, "impossible-subpath", ".bash_history"),
        extendedHistory: false,
        appendTimestamp: false,
      };

      const success = await syncer.appendToHistory("echo fail", target);
      expect(success).toBe(false);
    });
  });
});
