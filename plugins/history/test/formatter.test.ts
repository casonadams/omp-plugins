import { describe, expect, test } from "bun:test";
import { formatHistoryEntry } from "../src/formatter";

describe("formatHistoryEntry", () => {
  const FIXED_TIMESTAMP = 1700000000;

  describe("zsh formatting", () => {
    test("formats single-line command with default extended history", () => {
      const result = formatHistoryEntry("echo hello", "zsh", { timestamp: FIXED_TIMESTAMP });
      expect(result).toBe(": 1700000000:0;echo hello\n");
    });

    test("formats multiline command escaping intermediate newlines with backslashes", () => {
      const cmd = "for i in 1 2 3; do\n  echo $i\ndone";
      const result = formatHistoryEntry(cmd, "zsh", { timestamp: FIXED_TIMESTAMP });
      expect(result).toBe(": 1700000000:0;for i in 1 2 3; do\\\n  echo $i\\\ndone\n");
    });

    test("preserves semicolons, colons, quotes, and backslashes in commands", () => {
      const cmd = "echo \"hello:world\"; echo 'test\\path'";
      const result = formatHistoryEntry(cmd, "zsh", { timestamp: FIXED_TIMESTAMP });
      expect(result).toBe(": 1700000000:0;echo \"hello:world\"; echo 'test\\path'\n");
    });

    test("formats plain history when extendedHistory is false", () => {
      const result = formatHistoryEntry("ls -la", "zsh", {
        extendedHistory: false,
        timestamp: FIXED_TIMESTAMP,
      });
      expect(result).toBe("ls -la\n");
    });

    test("trims trailing whitespace and newlines but preserves internal newlines", () => {
      const cmd = "git status\n\n  \n";
      const result = formatHistoryEntry(cmd, "zsh", { timestamp: FIXED_TIMESTAMP });
      expect(result).toBe(": 1700000000:0;git status\n");
    });

    test("uses current timestamp when timestamp option is omitted", () => {
      const before = Math.floor(Date.now() / 1000);
      const result = formatHistoryEntry("pwd", "zsh");
      const after = Math.floor(Date.now() / 1000);

      const match = /^: (\d+):0;pwd\n$/.exec(result);
      expect(match).not.toBeNull();
      const parsedTime = Number(match![1]);
      expect(parsedTime).toBeGreaterThanOrEqual(before);
      expect(parsedTime).toBeLessThanOrEqual(after);
    });
  });

  describe("bash formatting", () => {
    test("formats plain command without timestamp by default", () => {
      const result = formatHistoryEntry("curl -I https://example.com", "bash", {
        timestamp: FIXED_TIMESTAMP,
      });
      expect(result).toBe("curl -I https://example.com\n");
    });

    test("formats command with timestamp comment when appendTimestamp is true", () => {
      const result = formatHistoryEntry("npm test", "bash", {
        appendTimestamp: true,
        timestamp: FIXED_TIMESTAMP,
      });
      expect(result).toBe("#1700000000\nnpm test\n");
    });

    test("trims trailing whitespace in bash formatting", () => {
      const result = formatHistoryEntry("bun run check   \n\n", "bash");
      expect(result).toBe("bun run check\n");
    });
  });
});
