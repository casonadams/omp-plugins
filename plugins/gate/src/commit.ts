import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Matches `git [-C dir] [-c k=v] [--opt] commit` at the start of a shell command or after
 * `;`, `&`, `|`, `(` or a newline, optionally behind an `rtk` prefix. It must not match
 * `git log -S commit`, `echo git commit` or `git commitish`.
 */
const GIT_COMMIT =
  /(?:^|[;&|(\n]\s*)(?:rtk\s+)?git(?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?))*\s+commit(?=\s|$)/;

const HEREDOC_START = /<<-?\s*(["']?)([A-Za-z_]\w*)\1/;
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;

/** Drops heredoc bodies: text fed to a program is data, not commands. */
function withoutHeredocs(command: string): string {
  const kept: string[] = [];
  let end: string | undefined;
  for (const line of command.split("\n")) {
    if (end !== undefined) {
      if (line.trim() === end) end = undefined;
      continue;
    }
    kept.push(line);
    end = HEREDOC_START.exec(line)?.[2];
  }
  return kept.join("\n");
}

/**
 * The command with heredoc bodies removed and the shell separators inside quoted strings blanked, so
 * `echo "run && git commit"` and a heredoc that mentions `git commit` are not read as commits, while
 * a quoted path such as `cd 'a b'` stays intact.
 */
export function shellText(command: string): string {
  return withoutHeredocs(command).replace(QUOTED, (quoted) => quoted.replace(/[;&|\n(]/g, " "));
}

export function runsGitCommit(command: string): boolean {
  return GIT_COMMIT.test(shellText(command));
}

function resolveDir(base: string, target: string | undefined): string {
  const raw = target?.replace(/^(["'])(.*)\1$/, "$2");
  if (!raw || raw.includes("$") || raw === "-") return base;
  const expanded =
    raw === "~" || raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(base, expanded);
}

/** The first shell word of `text`: a quoted string or a run of non-space characters. */
function firstWord(text: string): string | undefined {
  return /^\s*("[^"]*"|'[^']*'|\S+)/.exec(text)?.[1];
}

function dashC(words: string[]): string | undefined {
  const commit = words.indexOf("commit");
  const flag = words.slice(0, commit < 0 ? undefined : commit).indexOf("-C");
  return flag < 0 ? undefined : words[flag + 1];
}

/**
 * The directory a `git commit` in `command` runs in, starting from `cwd`: it follows `cd dir`
 * segments before the commit and a `git -C dir` on it. Falls back to `cwd` for anything it cannot
 * resolve (variables, `cd -`), which is the session's own repository.
 */
export function commitDirectory(command: string, cwd: string): string {
  let dir = cwd;
  for (const raw of shellText(command).split(/&&|\|\||;|\n/)) {
    const segment = raw.trim();
    if (/^cd(\s|$)/.test(segment)) dir = resolveDir(dir, firstWord(segment.slice(2)) ?? "~");
    else if (runsGitCommit(segment))
      return existing(resolveDir(dir, dashC(segment.split(/\s+/))), cwd);
  }
  return existing(dir, cwd);
}

/** `dir` when it is a directory, else `fallback`: spawning a process in a missing directory throws. */
function existing(dir: string, fallback: string): string {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : fallback;
}
