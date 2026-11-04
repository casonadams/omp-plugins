# gate

Completion gate for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`).

Before the agent can `git commit`, the gate runs [ripwire](https://github.com/casonadams/ripwire-rs)
verification over everything that differs from `HEAD` and blocks the commit when it fails. Before the
agent finishes a turn that changed source, it asks for a `Gate:` summary in the final message.

## Quick Install

```sh
omp plugin install gate@casonadams-plugins
```

> **Note:** The `@casonadams-plugins` qualifier is required. Running `omp plugin install gate` without it resolves to an unrelated package from the npm registry.

## Prerequisites

`ripwire-rs` on `PATH`; if it is missing the gate tries `ripwire`. With neither installed it passes and says
so. It does nothing outside a git repository.

## What it runs

| Step                    | Effect                                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--edit-check <symbol>` | Blocks when a public symbol added or changed in the diff has a changed contract and callers that no longer fit. Unchanged contracts never block, because ripwire counts a method's receiver as an argument (see its `DIRT.md`). Symbols are read from the diff for Rust, TypeScript/JavaScript, Python, Go and Dart. |
| `--quality-delta`       | Blocks on exit 2 (gating regressions: complexity, duplication, size). Run `<bin> . --quality-baseline` at the start of a task, or it compares with nothing, and the gate says so.                                                                                                                                    |
| `--test-gate <files>`   | Lists untested rows in the blast radius. Does not block: the static graph misses dynamic dispatch. Add a test or say why not.                                                                                                                                                                                        |
| `--situ <files>`        | Lists files that usually change with these (co-change partners).                                                                                                                                                                                                                                                     |

`git commit` is recognised behind `cd x &&`, `;`, `|`, `git -C dir`, `git -c k=v` and an `rtk` prefix. It
does not trigger on `git log -S commit`, `echo git commit` or `git commitish`. A repository with no commits
is compared with the empty tree.

## Behavior

- **`tool_call`:** a `bash` call that runs `git commit` is blocked unless the gate passes. The block reason is
  the gate output. A pass adds the output to the agent's context.
- **`session_stop`:** if source changed since the session started and the gate has not passed on that exact
  working tree, the agent is asked once more to run it. If it passed but the reply has no `Gate:` line, it is
  asked to add one. Omp caps these continuations.
- Only commits made through the agent's `bash` tool are intercepted, not commits from your own terminal.

## Configuration

| Variable           | Description                               |
| ------------------ | ----------------------------------------- |
| `OMP_GATE_DISABLE` | Set to any value to register no handlers. |

## Manual testing

```sh
cd plugins/gate && bun run check
```
