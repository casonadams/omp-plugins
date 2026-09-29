# guard

Security gatekeeper extension and plugin for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`).

Evaluates shell commands before execution and classifies their risk against software engineering, cloud infrastructure, and database boundaries using your configured **guard** or **judge** model.

## Quick Install

```sh
omp plugin install guard@casonadams-plugins
```

> **Note:** The `@casonadams-plugins` qualifier is required. Running `omp plugin install guard` without it resolves to an unrelated package from the npm registry.

## Features

- **Decoupled Model Configuration**: Uses your configured `guard` model role in `config.yml` (falls back to `judge`). Works with any provider supported by oh-my-pi (Ollama, Anthropic, OpenAI, Gemini, Bedrock, etc., as well as native TypeSafe / System One decision models).
- **Fail-Safe Enforcement**: If no guard/judge model is configured or credentials are missing, commands cannot run silently; execution is halted with an alert.
- **Interactive TUI Ask Dialog**: Flagged commands present the native oh-my-pi ask dialog displaying the command's action summary and risk assessment, defaulting to `Proceed` alongside scrollable code preview and custom feedback via `Other`.
- **Zero-Latency Critical Regex**: Instant interception for catastrophic destructive wipes (`rm -rf /`, `mkfs`, raw device writes, fork bombs, hard resets).
- **Developer-Friendly Boundaries**: Safe local operations (builds, tests, linters, repo file edits, diagnostics) are classified as safe without interrupting flow.

## Configuration

Configure your `~/.omp/agent/config.yml` with `approvalMode: yolo` alongside the `guard` model role:

```yaml
tools:
  approvalMode: yolo

modelRoles:
  guard: ollama/qwen2.5-coder:7b # Recommended local model (falls back to judge, e.g. typesafe/jev-latest)

marketplace:
  autoUpdate: notify # Alert when plugin updates are available (off|notify|auto)
```

### Why `approvalMode: yolo`?

By default, oh-my-pi prompts for manual human approval on tool executions. When paired with `guard`, you can safely enable `approvalMode: yolo`:

- **Zero Interruption for Safe Work**: Benign developer actions (builds, tests, linters, git inspections, file edits) execute instantly without manual confirm prompts.
- **Targeted Interception**: The guard pauses execution only when a command is destructive, mutates cloud or database infrastructure, exfiltrates secrets, or poses a security risk.

### Keybindings (Vim `j`/`k` & `Tab` Navigation)

By default, oh-my-pi navigates selection dialogs using arrow keys. To enable Vim `j`/`k` and `Tab`/`Shift+Tab` navigation, add the following to `~/.omp/agent/keybindings.yml`:

```yaml
tui.select.up:
  - Up
  - k
  - Shift+Tab

tui.select.down:
  - Down
  - j
  - Tab
```

### Recommended Local Model: `qwen2.5-coder:7b`

For local, offline command inspection without cloud API latency or cost, `ollama/qwen2.5-coder:7b` is strongly recommended for the `guard` role:

- **Domain Comprehension**: Pretrained extensively on code, shell scripts, and DevOps tools (git, kubectl, terraform, docker, cloud CLIs, database clients).
- **Low Latency & Small Footprint**: Quantized (Q4_K_M) fits easily into standard Apple Silicon unified memory or consumer GPUs.
- **Reliable Structured Output**: Produces deterministic JSON matching the required schema at `temperature: 0.0`.
- **Air-Gapped Privacy**: Shell commands, local paths, arguments, and sensitive parameters remain on-device.

## Verification

```sh
omp plugin list
omp plugin doctor
```

## Upgrading

Upgrading requires fetching the latest release from GitHub into your local marketplace cache before applying the upgrade:

```sh
# 1. Fetch latest catalog metadata from GitHub
omp plugin marketplace update casonadams-plugins

# 2. Upgrade the plugin
omp plugin upgrade guard@casonadams-plugins
```

_(Or inside an interactive `omp` session: `/marketplace update casonadams-plugins` followed by `/marketplace upgrade guard@casonadams-plugins`)_

If you need to force a clean reinstall:

```sh
omp plugin install guard@casonadams-plugins --force
```
