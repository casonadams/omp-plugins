# Shell History Sync Plugin Spec

## Status

Draft

## Problem

When `omp` executes shell commands via its `bash` tool, they run in isolated child processes and pseudo-terminals. These commands do not enter the developer's interactive shell history (`~/.zsh_history` or `~/.bash_history`). As a result, developers cannot readily recall, inspect, or rerun commands that `omp` executed using standard interactive shell mechanisms such as reverse history search (`Ctrl+R`), the `history` command, or arrow navigation.

## Users and stakeholders

- Developers using `omp` for coding, system administration, and automation.
- Local interactive shell environments, primarily Zsh and Bash on macOS and Linux.

## Goals

- Automatically capture commands executed by `omp`'s `bash` tool upon successful execution.
- Auto-detect the developer's active shell (`zsh` vs. `bash`) and target history file using environment variables (`$SHELL`, `$HISTFILE`) with user configuration overrides.
- Format history entries to match the target shell's native history format:
  - Zsh extended history format (`: <epoch>:0;<command>` with `\\\n` multiline escaping).
  - Bash standard history format (plain command lines or `#<epoch>` timestamp headers).
- Honor standard shell hygiene conventions:
  - `ignorespace`: Ignore commands beginning with leading whitespace (avoiding logging sensitive one-liners).
  - `ignoredups`: Suppress consecutive duplicate commands within the active session.
- Safely and non-destructively append to history files without corrupting history or blocking/crashing `omp` sessions.

## Non-goals

- Bi-directional synchronization (syncing user interactive shell history into `omp`).
- Synchronizing commands that failed, errored, or were aborted.
- Multi-machine, cloud-based, or daemon-level history synchronization.
- Native support for Fish, Nushell, PowerShell, or Windows CMD in initial release.
- Modifying interactive shell running in-memory history without reload (relies on shell mechanisms like Zsh `share_history` / `inc_append_history` or Bash `history -n`).

## Current behavior

`omp` executes commands using its built-in `bash` tool. Command inputs and stdout/stderr results are logged within `omp`'s session transcript files (`~/.omp/agent/sessions/...`), but no writes are made to `$HISTFILE`, `~/.zsh_history`, or `~/.bash_history`.

## Desired behavior

When `omp` completes a `bash` tool execution:

1. The plugin checks the execution outcome via the `tool_result` event.
2. If the command exited successfully (`isError: false` / exit code 0), the plugin checks filtering rules (`ignorespace` and `ignoredups`).
3. If valid, the plugin formats the command for the target shell (Zsh extended or Bash format).
4. The plugin appends the formatted command entry to the resolved history file using safe append semantics.
5. If any filesystem or formatting error occurs, it is handled gracefully without interfering with `omp`'s tool response or session.

## Requirements

- REQ-001: **Tool Result Interception**: The plugin MUST listen to the `tool_result` extension event and filter exclusively for `event.toolName === "bash"`.
- REQ-002: **Success-Only Filtering**: The plugin MUST only synchronize commands whose tool execution completed without error (`event.isError === false`).
- REQ-003: **Shell Target Auto-Detection**:
  - The plugin MUST determine the shell target by inspecting:
    1. Plugin configuration options (explicit `shell` and `historyFile` settings).
    2. The `$HISTFILE` environment variable if set and valid.
    3. The `$SHELL` environment variable (e.g., matching `*/zsh` for Zsh, `*/bash` for Bash).
    4. Platform fallback: Default to Zsh (`~/.zsh_history`) on macOS (`process.platform === "darwin"`) and Bash (`~/.bash_history`) on Linux/other platforms.
- REQ-004: **Zsh Extended History Formatting**:
  - For Zsh targets using extended history (the default for macOS and standard Zsh setups):
    - Format: `: <epoch_seconds>:0;<command>\n`.
    - Multiline commands MUST have internal newlines escaped with a backslash (`\\\n`) in accordance with Zsh extended history syntax.
- REQ-005: **Bash History Formatting**:
  - For Bash targets:
    - Format: Single- or multi-line command followed by a trailing newline.
    - If timestamping is enabled via configuration, write `#<epoch_seconds>\n<command>\n`.
- REQ-006: **Whitespace & Deduplication Filtering**:
  - `ignorespace`: The plugin MUST NOT synchronize any command that begins with a whitespace character (` ` or `\t`).
  - `ignoredups`: The plugin MUST NOT synchronize a command if it is identical (trimmed or exact string match) to the immediately preceding successfully synchronized command within the current session.
  - Empty or whitespace-only commands MUST NOT be synchronized.
- REQ-007: **Safe Atomic Appends**:
  - Appends to the history file MUST use append file flags (`a` or `O_APPEND`) to ensure atomic writes for payloads under POSIX `PIPE_BUF` limits.
  - The plugin MUST NOT overwrite or truncate the target file.
- REQ-008: **Permission and Directory Handling**:
  - If the target history file does not exist, the plugin MUST create it with restrictive file mode `0600`.
  - If the parent directory does not exist, the plugin SHOULD attempt recursive directory creation or fail gracefully.
- REQ-009: **Fault Tolerance and Non-Interference**:
  - Any error encountered during resolution, formatting, or file writing MUST NOT reject, throw, or delay the `tool_result` pipeline in `omp`. Errors SHOULD log a debug message or warning without interrupting the user.

## Invariants and security boundaries

- **Zero Command Modification**: The plugin MUST NOT alter the command being executed or modify `event.content` / `event.details`.
- **Non-Blocking Operation**: History file I/O operations MUST NOT block the agent lifecycle or cause timeout errors in `ExtensionRunner`.
- **Secret Hygiene**: Commands prefixed with leading space (a universal Unix shell convention for commands containing secrets or passwords) MUST NEVER be written to disk.
- **Permission Boundary**: Any newly created history file MUST have permissions `0600` (readable and writable only by the current user).

## Definition of done

- Plugin created under `plugins/shell-history` with entry point `index.ts`, `package.json`, and TypeScript configuration matching repository standards.
- Plugin registered in `marketplace.json`.
- Comprehensive test suite covering:
  - Success vs. failure filtering (`isError: false` vs `isError: true`).
  - Ignoring non-bash tools (`read`, `write`, `edit`).
  - Zsh extended history formatting including multiline command escaping.
  - Bash history formatting.
  - `ignorespace` leading-space filtering.
  - `ignoredups` consecutive duplicate suppression.
  - Auto-detection logic across `$HISTFILE`, `$SHELL`, and platform defaults.
  - Graceful handling of file system errors (permission denied, missing directories).
- All checks pass cleanly (`bun test`, `oxlint`, `tsc --noEmit`, `prettier --check`).

## Acceptance criteria

- AC-001: Given a `tool_result` event for `bash` with command `git status` and `isError: false`, when the target is Zsh, then `: <timestamp>:0;git status\n` is appended to `~/.zsh_history`.
- AC-002: Given a `tool_result` event for `bash` with `isError: true` (command failed), when the event is processed, then no entry is written to any history file.
- AC-003: Given a `tool_result` event for another tool (e.g. `read` or `write`), when the event is processed, then no history write occurs.
- AC-004: Given a multiline command:
  ```bash
  cat << 'EOF' > test.txt
  hello world
  EOF
  ```
  when targeting Zsh extended history, then internal newlines are escaped with a trailing backslash (`\\\n`) preserving multiline continuity in Zsh history search.
- AC-005: Given a command starting with a leading space (` export API_KEY=secret`), when the command executes successfully, then it is ignored and not written to the history file.
- AC-006: Given two identical consecutive commands (`cargo check` followed by `cargo check`), when the second command completes successfully, then only the first invocation is written to history.
- AC-007: Given `$SHELL=/bin/bash`, when no configuration override is set, then the plugin formats for Bash and targets `~/.bash_history`.
- AC-008: Given an inaccessible or write-protected history file path, when a command completes, then the plugin catches the error silently without crashing `omp` or throwing to the user.

## Edge cases

- **Multiline commands with trailing newlines**: Trailing newlines should be trimmed so they do not produce empty continuation lines in Zsh or empty history items in Bash.
- **Commands containing backslashes**: Backslashes within the command itself must be preserved without corrupting the Zsh line-continuation syntax.
- **Commands containing semicolons or colons**: In Zsh extended history, the first colon and semicolon delineate metadata (`: <timestamp>:<duration>;`); semicolons in the command body must remain untouched after the delimiter.
- **Concurrent shell writes**: Multiple shells appending simultaneously; atomic file append (`flags: 'a'`) ensures POSIX atomic appends without interleaved character corruption.
- **History file does not exist initially**: Must create the file with `0600` permissions.

## Constraints

- Zero external third-party dependencies outside standard monorepo tooling (`@oh-my-pi/pi-ai`, Node/Bun builtins `fs`, `path`, `os`).
- Fast execution with minimal memory allocation.
- Compliant with repository guidelines in `AGENTS.md` (no dead code, concise functions, tests for observable behavior).

## Risks and mitigations

- **Risk**: Corrupting Zsh history if multiline formatting syntax is wrong.
  - **Mitigation**: Strictly validate against Zsh's native parser rules (where lines continuing a multiline command end with a trailing backslash before newline). Add targeted tests asserting exact line-break representations.
- **Risk**: File contention or hanging I/O if history file is on a network drive or locked file system.
  - **Mitigation**: Perform asynchronous non-blocking file appends with catch handlers to ensure unhandled promise rejections never bubble up.

## Open questions

- None (all blocking questions resolved).

## References

- Zsh Extended History format: `zshaddhistory` and Zsh file format (`: <beginning time>:<elapsed seconds>;<command>`).
- Bash History format (`HISTFILE`, `HISTTIMEFORMAT`).
- Existing plugin convention: `plugins/guard` in `omp-plugins`.
