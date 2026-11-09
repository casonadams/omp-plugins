# zone-dividers

Framed thinking divider and a matching **FINAL ANSWER** marker for `oh-my-pi` transcripts, with eight switchable styles.

`omp` draws thinking blocks as plain italic text and glues them to the answer, so the boundary between reasoning, tool activity and the final answer disappears. This extension draws both boundaries:

```
╭─────────────────────────────────────────────────────────────────────────────╮
│                     ◕‿◕ THINKING DONE · 1.6k chars ◕‿◕                      │
╰─────────────────────────────────────────────────────────────────────────────╯

───────────────────────────────────────────────────────────────────────────────

◕‿◕ FINAL ANSWER ◕‿◕

The root cause is the resolver on the gateway side.
```

## Prerequisites

- `omp` 18.16 or newer.
- The answer-side marker is gated by `extensionRenderers.assistantText`:

```sh
omp config set extensionRenderers.assistantText true
```

Restart the session after installing or toggling that setting.

## Install

```sh
omp plugin install zone-dividers@casonadams-plugins
```

## Usage

```text
/zone-style
```

Pick one of eight styles. The choice is written to `~/.omp/agent/zone-dividers.json` and survives restarts; cancelling the picker leaves the current style untouched.

| Style             | Rule | Decoration                       | Rule color     |
| ----------------- | ---- | -------------------------------- | -------------- |
| S1 hairline       | `─`  | —                                | `mdHr`         |
| S2 chip (default) | `─`  | — (label gets a background fill) | `mdHr`         |
| S3 double         | `═`  | —                                | `borderAccent` |
| S4 dotted         | `┄`  | `✻` both sides                   | `mdHr`         |
| S5 banner         | `─`  | — (whole row filled)             | `mdHr`         |
| S6 bolt           | `─`  | `⚡` both sides                  | `warning`      |
| S7 blocks         | `░`  | `▓▒` / `▒▓`                      | `borderMuted`  |
| S8 kaomoji        | `─`  | `◕‿◕` both sides                 | `accent`       |

## Runtime behavior

- **Thinking divider** — three rows: top rule, centered label row (`THINKING DONE · <N> chars`, `k` notation above 1000), bottom rule. Width is `terminal width - 1`, capped at 80 columns; narrow terminals keep a floor of `label width + 4` columns.
- **Answer marker** — two full-width rules around `FINAL ANSWER`, carrying the style's decoration. Added whenever an assistant text block starts, including right after a thinking block.
- **Consecutive thinking blocks** get one divider, after the last block of the run.
- **`hideThinkingBlock: true`** — the host stops calling the thinking hook, so the divider disappears; the answer marker stays.
- **`symbolPreset: ascii`** — thinking-side rules and decorations fall back to `-`, `=`, `:`, `#`, `*`, `^_^`. The answer-side decoration stays Unicode: the text renderer receives no theme.
- Display only: session records, exports and model context keep the reply as written.

## Manual testing

1. Set `extensionRenderers.assistantText` to `true` and restart.
2. Send a prompt that produces thinking plus a tool call, e.g. `Think briefly, run `echo ok` with bash, then answer ok`.
3. Expect a three-row box under the thinking text and `FINAL ANSWER` between two rules above the answer.
4. Run `/zone-style`, pick another style, send a new message: the divider repaints in the new style.
5. Set `symbolPreset: ascii` and restart: thinking-side rules and decorations fall back to ASCII.

## Uninstall

```sh
omp plugin uninstall zone-dividers@casonadams-plugins
```

## License

MIT — source: <https://github.com/wahaha1024/omp-zone-dividers>
