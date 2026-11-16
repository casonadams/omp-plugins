# refine

Read-only repository scans for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`).

`/refine <profile>` inventories the repo, then asks the main agent to fan out `scout` subagents over the
highest-risk scopes for the chosen profile. The agent validates and dedupes what they return and
presents findings with severity, confidence, `file:line` evidence, impact, and a recommendation. It
asks before fixing anything.

## Quick Install

```sh
omp plugin install refine@casonadams-plugins
```

> **Note:** The `@casonadams-plugins` qualifier is required. Running `omp plugin install refine` without it resolves to an unrelated package from the npm registry.

## Usage

```text
/refine review
/refine security
/refine performance
/refine reliability
/refine architecture
/refine help
```

Tab after `/refine` lists the profiles, each with a one-line description. A bare `/refine` prints usage and
does not start a scan.

| Profile        | Focus                                                                                |
| -------------- | ------------------------------------------------------------------------------------ |
| `review`       | Correctness, error handling, test gaps, regression risk, behavior-preserving cleanup |
| `security`     | Trust boundaries, authn/authz, injection, secrets, unsafe parsing, data exposure     |
| `performance`  | Algorithmic complexity, I/O hot spots, caching, concurrency, resource usage          |
| `reliability`  | Timeouts, retries, idempotency, partial failures, cleanup, observability             |
| `architecture` | Module boundaries, coupling, domain/adapter/orchestration layering, data flow        |

## Behavior

- The inventory walks the repo in memory (skipping `node_modules`, `dist`, `target`, `.git` and similar,
  never following symlinks, capped at 10,000 directories and 50,000 entries). Repos over 5,000 files or
  2,000 source files, or whose walk hit a cap, run in `large` mode: 3 to 5 scopes instead of 1 to 3.
- The scan prompt is sent as a `refine-scan` message that starts a turn. Nothing is written into the repository.
- Read-only enforcement for the analysis comes from omp's `scout` agent, whose tools are
  `read`, `find`, `grep`, `glob`, and `web_search`. The coordinating main agent is told not to edit or
  run build, test, or network commands, but that is an instruction, not a block.
- Scopes are computed in code: reviewable files (everything except images, fonts, media, archives,
  lockfiles, source maps, and docs such as `.md`) are split into at most 3 (standard) or 5 (large)
  disjoint, roughly equal slices by packing sibling directories, and the prompt lists them in full.
  Languages the inventory does not recognize are still sized, so they are split too. Each scout gets
  one slice.
- The `performance` profile labels findings structural hypotheses unless a benchmark or profile exists in the repository.
- Inventory metadata (file and directory names) is JSON-escaped in the prompt and labelled untrusted.
- The command refuses to start while the agent is busy.

## Manual testing

```sh
cd plugins/refine && bun run check
```

Then in an `omp` session loaded with the plugin, run `/refine review` and confirm that
the agent calls `task` with `agent: "scout"` and ends by asking before it fixes anything.
