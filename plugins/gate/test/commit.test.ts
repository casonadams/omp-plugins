import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { commitDirectory, runsGitCommit } from "../src/commit";

describe("runsGitCommit", () => {
  test.each([
    "git commit -m x",
    "cd /tmp/r && git commit -am 'x y'",
    "git -C repo commit",
    "rtk git commit -m x",
    "cargo test; git commit -m z",
    "git add -A && git commit -q -F -",
    "git -c user.name=a commit",
    "echo hi\ngit commit",
  ])("catches %j", (command) => expect(runsGitCommit(command)).toBe(true));

  test.each([
    "git log --oneline -S commit",
    "git show --stat HEAD | grep commit",
    "echo git commit",
    "git status",
    "git commitish",
    'git log --grep="fix: commit"',
    'echo "run && git commit"',
    "echo 'then; git commit -m x'",
    "cat <<'EOF'\nfoo && git commit -m x\nEOF",
    "python3 - <<EOF\nx = 'a'\n; git commit\nEOF",
    "cat <<-EOF\n\tgit commit\n\tEOF",
  ])("ignores %j", (command) => expect(runsGitCommit(command)).toBe(false));

  test("still sees a commit around quoted text and after a heredoc", () => {
    expect(runsGitCommit('git commit -m "fix; thing && more"')).toBe(true);
    expect(runsGitCommit("cat <<'EOF'\nbody\nEOF\ngit commit -m x")).toBe(true);
    expect(runsGitCommit("cat <<EOF > f\nbody\nEOF\n&& git commit")).toBe(true);
    expect(runsGitCommit("git commit -m 'a' && git commit -m \"b\"")).toBe(true);
  });

  test("an unterminated heredoc hides the rest, not what came before it", () => {
    expect(runsGitCommit("git commit -m x && cat <<EOF\nnever closed git commit")).toBe(true);
    expect(runsGitCommit("cat <<EOF\nnever closed\ngit commit")).toBe(false);
  });
});

describe("commitDirectory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-dirs-"));
  const sub = path.join(root, "sub");
  const spaced = path.join(root, "with space");
  fs.mkdirSync(sub);
  fs.mkdirSync(spaced);
  const run = (command: string) => commitDirectory(command, root);

  test.each([
    ["git commit -m x", root],
    [`cd ${sub} && git commit -m x`, sub],
    ["cd sub && git commit -m x", sub],
    ["cd sub; cd .. && git commit", root],
    [`git -C ${sub} commit -m x`, sub],
    ["git -C sub commit", sub],
    [`cd ${root} && git -C sub commit`, sub],
    [`cd '${spaced}' && git commit`, spaced],
    [`rtk git -C ${sub} commit`, sub],
    ["git add -A && git commit -q -F -", root],
    ["cd $HOME && git commit", root],
    ["cd - && git commit", root],
    [`cd ${sub} && echo hi; git commit`, sub],
    [`git -C ${sub} status && git commit`, root],
    [`cd ${sub} && git commit -m "a; cd /tmp"`, sub],
    [`cat <<'EOF'\ncd /tmp\nEOF\ngit commit`, root],
  ])("%j runs in %s", (command, expected) => expect(run(command)).toBe(expected));

  test("a redirect or trailing words after cd are not part of the directory", () => {
    expect(run(`cd ${sub} 2>/dev/null && git commit`)).toBe(sub);
    expect(run("cd /no/such/dir 2>/dev/null; git commit")).toBe(root);
  });

  test("a directory that does not exist falls back to the starting one", () => {
    expect(run("cd /no/such/dir && git commit")).toBe(root);
    expect(run("git -C /no/such/dir commit")).toBe(root);
    expect(run(`cd ${path.join(sub, "..", "nope")} && git commit`)).toBe(root);
  });

  test("a bare cd goes home", () => {
    expect(commitDirectory("cd && git commit", root)).toBe(os.homedir());
  });
});
