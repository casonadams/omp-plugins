import { describe, expect, test } from "bun:test";
import {
  ENV_HISTFILE,
  ENV_OMP_HISTORY_FILE,
  ENV_OMP_HISTORY_TARGET,
  ENV_OMP_SHELL_HISTORY_FILE,
  ENV_OMP_SHELL_HISTORY_TARGET,
  ENV_SHELL,
} from "../src/constants";
import { detectShellType, expandTilde, resolveTarget } from "../src/resolver";

describe("resolver", () => {
  describe("detectShellType", () => {
    test("respects explicit options.shell over environment", () => {
      const env = { [ENV_OMP_HISTORY_TARGET]: "bash", [ENV_SHELL]: "/bin/bash" };
      expect(detectShellType({ shell: "zsh" }, env, "linux")).toBe("zsh");
      expect(detectShellType({ shell: "bash" }, env, "darwin")).toBe("bash");
    });

    test("ignores options.shell when set to auto", () => {
      const env = { [ENV_OMP_HISTORY_TARGET]: "bash" };
      expect(detectShellType({ shell: "auto" }, env, "darwin")).toBe("bash");
    });

    test("reads OMP_HISTORY_TARGET environment variable", () => {
      expect(detectShellType({}, { [ENV_OMP_HISTORY_TARGET]: "zsh" }, "linux")).toBe("zsh");
      expect(detectShellType({}, { [ENV_OMP_HISTORY_TARGET]: "bash" }, "darwin")).toBe("bash");
    });

    test("reads legacy OMP_SHELL_HISTORY_TARGET environment variable", () => {
      expect(detectShellType({}, { [ENV_OMP_SHELL_HISTORY_TARGET]: "zsh" }, "linux")).toBe("zsh");
      expect(detectShellType({}, { [ENV_OMP_SHELL_HISTORY_TARGET]: "bash" }, "darwin")).toBe(
        "bash",
      );
    });

    test("detects shell from HISTFILE path", () => {
      expect(detectShellType({}, { [ENV_HISTFILE]: "/home/user/.zsh_history" }, "linux")).toBe(
        "zsh",
      );
      expect(detectShellType({}, { [ENV_HISTFILE]: "/home/user/.bash_history" }, "darwin")).toBe(
        "bash",
      );
    });

    test("detects shell from SHELL environment variable", () => {
      expect(detectShellType({}, { [ENV_SHELL]: "/bin/zsh" }, "linux")).toBe("zsh");
      expect(detectShellType({}, { [ENV_SHELL]: "/usr/local/bin/bash" }, "darwin")).toBe("bash");
      expect(detectShellType({}, { [ENV_SHELL]: "zsh" }, "linux")).toBe("zsh");
      expect(detectShellType({}, { [ENV_SHELL]: "bash" }, "darwin")).toBe("bash");
    });

    test("falls back to platform default when no indicators are present", () => {
      expect(detectShellType({}, {}, "darwin")).toBe("zsh");
      expect(detectShellType({}, {}, "linux")).toBe("bash");
      expect(detectShellType({}, {}, "win32")).toBe("bash");
    });
  });

  describe("expandTilde", () => {
    test("expands leading ~/ to homedir", () => {
      expect(expandTilde("~/.zsh_history", "/Users/tester")).toBe("/Users/tester/.zsh_history");
      expect(expandTilde("~/nested/dir/history", "/home/tester")).toBe(
        "/home/tester/nested/dir/history",
      );
    });

    test("expands lone ~ to homedir", () => {
      expect(expandTilde("~", "/Users/tester")).toBe("/Users/tester");
    });

    test("leaves non-tilde paths unmodified", () => {
      expect(expandTilde("/var/log/history", "/Users/tester")).toBe("/var/log/history");
      expect(expandTilde("relative/path", "/Users/tester")).toBe("relative/path");
      expect(expandTilde("~username/path", "/Users/tester")).toBe("~username/path");
    });
  });

  describe("resolveTarget", () => {
    const homedir = "/Users/cason";

    test("resolves default darwin target to zsh and expanded ~/.zsh_history", () => {
      const target = resolveTarget({}, {}, "darwin", homedir);
      expect(target).toEqual({
        shellType: "zsh",
        historyPath: "/Users/cason/.zsh_history",
        extendedHistory: true,
        appendTimestamp: false,
      });
    });

    test("resolves default linux target to bash and expanded ~/.bash_history", () => {
      const target = resolveTarget({}, {}, "linux", homedir);
      expect(target).toEqual({
        shellType: "bash",
        historyPath: "/Users/cason/.bash_history",
        extendedHistory: true,
        appendTimestamp: false,
      });
    });

    test("prioritizes options.historyFile over environment variables", () => {
      const target = resolveTarget(
        { historyFile: "/custom/file" },
        { [ENV_OMP_HISTORY_FILE]: "/env/file" },
        "darwin",
        homedir,
      );
      expect(target.historyPath).toBe("/custom/file");
    });

    test("prioritizes OMP_HISTORY_FILE over HISTFILE and defaults", () => {
      const target = resolveTarget(
        {},
        {
          [ENV_OMP_HISTORY_FILE]: "~/custom/omp_hist",
          [ENV_HISTFILE]: "/etc/histfile",
        },
        "darwin",
        homedir,
      );
      expect(target.historyPath).toBe("/Users/cason/custom/omp_hist");
    });

    test("prioritizes OMP_SHELL_HISTORY_FILE alias over HISTFILE", () => {
      const target = resolveTarget(
        {},
        {
          [ENV_OMP_SHELL_HISTORY_FILE]: "~/custom/omp_shell_hist",
          [ENV_HISTFILE]: "/etc/histfile",
        },
        "darwin",
        homedir,
      );
      expect(target.historyPath).toBe("/Users/cason/custom/omp_shell_hist");
    });

    test("uses HISTFILE if present and no options or OMP_HISTORY_FILE", () => {
      const target = resolveTarget({}, { [ENV_HISTFILE]: "~/my_histfile" }, "darwin", homedir);
      expect(target.historyPath).toBe("/Users/cason/my_histfile");
    });

    test("preserves custom extendedHistory and appendTimestamp options", () => {
      const target = resolveTarget(
        { extendedHistory: false, appendTimestamp: true },
        {},
        "darwin",
        homedir,
      );
      expect(target.extendedHistory).toBe(false);
      expect(target.appendTimestamp).toBe(true);
    });
  });
});
