# history

Automatic shell history sync extension and plugin for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`).

Syncs successful `bash` tool commands executed during an `omp` session directly into your native shell history file (`~/.zsh_history`, `~/.bash_history`, or `$HISTFILE`). This allows commands run by the agent to be searched, recalled, and re-executed using native terminal history shortcuts (`Ctrl+R`, up-arrow, or the `history` command).

## Quick Install

```sh
omp plugin install history@casonadams-plugins
```

> **Note:** The `@casonadams-plugins` qualifier is required. Running `omp plugin install history` without it resolves to an unrelated package from the npm registry.

## Features

- **Automatic Shell Detection**: Detects whether your environment uses Zsh or Bash via environment variables (`HISTFILE`, `SHELL`) and OS platform defaults.
- **Native Zsh Extended History**: Formats commands according to Zsh extended history (`: <epoch>:0;<cmd>\n`) with proper intermediate backslash (`\\\n`) escaping for multiline commands.
- **Native Bash History**: Appends commands directly in standard Bash history format, with optional timestamp entries (`#<epoch>`).
- **Shell Hygiene**:
  - `ignorespace`: Commands with leading whitespace (space or tab) are skipped to avoid persisting sensitive or temporary commands.
  - `ignoredups`: Consecutive duplicate commands are not duplicated in history.
- **Safe & Non-Blocking**: History writes use atomic append operations with restrictive file permissions (`0600`). Any file system write errors are caught silently so the agent never crashes or hangs.
- **Error Filtering**: Only successful commands are recorded; commands that exit with an error (`isError: true`) are ignored.

## Configuration

The plugin works out of the box with zero configuration. You can customize target detection and file paths using environment variables:

| Variable                                             | Description                                    | Default                                                  |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `OMP_HISTORY_FILE` (or `OMP_SHELL_HISTORY_FILE`)     | Explicit path to the history file to append to | Derived from shell target                                |
| `OMP_HISTORY_TARGET` (or `OMP_SHELL_HISTORY_TARGET`) | Force shell target type (`zsh` or `bash`)      | Auto-detected from `HISTFILE` / `SHELL`                  |
| `HISTFILE`                                           | Standard shell history file path               | `~/.zsh_history` (macOS/zsh) or `~/.bash_history` (bash) |
| `SHELL`                                              | User login shell path                          | Auto-detected                                            |

### Plugin Options

When initialized programmatically or via extension configuration, the following options are supported:

```ts
interface ShellHistoryOptions {
  shell?: "zsh" | "bash" | "auto";
  historyFile?: string;
  extendedHistory?: boolean; // default: true for zsh
  ignoreSpace?: boolean; // default: true
  ignoreDups?: boolean; // default: true
  appendTimestamp?: boolean; // default: false for bash
}
```

## Manual Verification

To verify that commands are being synced:

1. Launch `omp` and run a bash command:
   ```sh
   omp
   # Inside omp, execute a bash command or prompt the agent to run a shell command:
   # e.g., git status
   ```
2. In your terminal, inspect your history file:
   ```sh
   tail -n 5 ~/.zsh_history # or ~/.bash_history
   ```
3. Test search via `Ctrl+R` to verify the command is recallable.
