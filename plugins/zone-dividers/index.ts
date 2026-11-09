import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";

/** 内容块类型；除下列四类外的块一律按「非思考边界」处理 */
type Kind = "thinking" | "text" | "toolCall" | "image" | (string & {});
interface Seg {
  kind: Kind;
}
type ThemeLike = {
  fg(color: string, text: string): string;
  bgFill(color: string, text: string): string;
  getSymbolPreset?(): string;
};

type StyleId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";

interface Deco {
  left: string;
  leftCols: number;
  right: string;
  rightCols: number;
  asciiLeft: string;
  asciiRight: string;
}
interface StyleDef {
  id: StyleId;
  name: string; // /zone-style 列表文案
  rule: { ch: string; ascii: string }; // 线字符（随 symbolPreset 切换）
  ruleColor: "mdHr" | "borderAccent" | "borderMuted" | "warning" | "accent";
  chip: boolean; // 标签段加 customMessageBg 底色
  banner: boolean; // 整行底色带 + 居中（优先于 chip）
  deco?: Deco; // 标签两侧装饰；无则整段省略
}

const STYLES: Record<StyleId, StyleDef> = {
  S1: {
    id: "S1",
    name: "S1 细线 hairline",
    rule: { ch: "─", ascii: "-" },
    ruleColor: "mdHr",
    chip: false,
    banner: false,
  },
  S2: {
    id: "S2",
    name: "S2 胶囊 chip",
    rule: { ch: "─", ascii: "-" },
    ruleColor: "mdHr",
    chip: true,
    banner: false,
  },
  S3: {
    id: "S3",
    name: "S3 双线 double",
    rule: { ch: "═", ascii: "=" },
    ruleColor: "borderAccent",
    chip: false,
    banner: false,
  },
  S4: {
    id: "S4",
    name: "S4 点线星芒 dotted",
    rule: { ch: "┄", ascii: ":" },
    ruleColor: "mdHr",
    chip: false,
    banner: false,
    deco: { left: "✻", leftCols: 1, right: "✻", rightCols: 1, asciiLeft: "*", asciiRight: "*" },
  },
  S5: {
    id: "S5",
    name: "S5 色带 banner",
    rule: { ch: "─", ascii: "-" },
    ruleColor: "mdHr",
    chip: false,
    banner: true,
  },
  S6: {
    id: "S6",
    name: "S6 闪电 bolt",
    rule: { ch: "─", ascii: "-" },
    ruleColor: "warning",
    chip: false,
    banner: false,
    deco: { left: "⚡", leftCols: 2, right: "⚡", rightCols: 2, asciiLeft: "*", asciiRight: "*" },
  },
  S7: {
    id: "S7",
    name: "S7 方块渐变 blocks",
    rule: { ch: "░", ascii: "#" },
    ruleColor: "borderMuted",
    chip: false,
    banner: false,
    deco: { left: "▓▒", leftCols: 2, right: "▒▓", rightCols: 2, asciiLeft: "##", asciiRight: "##" },
  },
  S8: {
    id: "S8",
    name: "S8 颜文字 kaomoji",
    rule: { ch: "─", ascii: "-" },
    ruleColor: "accent",
    chip: false,
    banner: false,
    deco: {
      left: "◕‿◕",
      leftCols: 3,
      right: "◕‿◕",
      rightCols: 3,
      asciiLeft: "^_^",
      asciiRight: "^_^",
    },
  },
};
const DEFAULT_STYLE: StyleId = "S2";
const THINKING_LABEL = (chars: number) => `THINKING DONE · ${formatChars(chars)} chars`;

const replies = new Map<number, Seg[]>();
let lastAssistantStamp: number | undefined;
let textRendererRan = false;
let sawTextBlock = false;
let warned = false;
let styleId: StyleId = DEFAULT_STYLE;

/** `1234` → `1.2k`；`1000` → `1k`；`999` → `999` */
function formatChars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);
}

function ascii(theme: ThemeLike): boolean {
  return theme.getSymbolPreset?.() === "ascii";
}

/** 标签串只含 ASCII 与 U+00B7 `·`，因此可见列宽 = 码点数 */
function labelColumns(text: string): number {
  return [...text].length;
}

function remember(message: AssistantMessage): void {
  const blocks: Seg[] = [];
  message.content.forEach((block, index) => {
    blocks[index] = { kind: block.type };
  });
  replies.set(message.timestamp, blocks);
  lastAssistantStamp = message.timestamp;
  while (replies.size > 64) {
    const oldest = replies.keys().next().value as number | undefined;
    if (oldest === undefined || oldest === message.timestamp) break;
    replies.delete(oldest);
  }
}

/** 该回复中从 index 起向后的第一个可见块；image 不占分区；表缺失返回 undefined */
function successor(stamp: number | undefined, index: number): Seg | undefined {
  const blocks =
    (stamp !== undefined ? replies.get(stamp) : undefined) ??
    (lastAssistantStamp !== undefined ? replies.get(lastAssistantStamp) : undefined);
  if (!blocks) return undefined;
  for (let i = index; i < blocks.length; i++) {
    const seg = blocks[i];
    if (!seg || seg.kind === "image") continue;
    return seg;
  }
  return undefined;
}

/** 思考区下线：整行方框，标签居中；hideThinkingBlock 为真时宿主不调用本钩子，无需自行判定 */
function renderThinkingRule(width: number, chars: number, theme: ThemeLike): readonly string[] {
  const style = STYLES[styleId];
  const isAscii = ascii(theme);
  const rule = isAscii ? style.rule.ascii : style.rule.ch;
  const label = THINKING_LABEL(chars);
  const left = style.deco ? (isAscii ? style.deco.asciiLeft : style.deco.left) : "";
  const right = style.deco ? (isAscii ? style.deco.asciiRight : style.deco.right) : "";
  const leftCols = style.deco ? (isAscii ? style.deco.asciiLeft.length : style.deco.leftCols) : 0;
  const rightCols = style.deco
    ? isAscii
      ? style.deco.asciiRight.length
      : style.deco.rightCols
    : 0;
  const headCols = leftCols + rightCols + labelColumns(label) + (left ? 1 : 0) + (right ? 1 : 0);
  const head = `${left ? `${left} ` : ""}${label}${right ? ` ${right}` : ""}`;
  // 边框占 2 列、左右各留 1 列空白；窄终端按标签宽度保底，不裁剪转义序列
  const total = Math.min(Math.max(width - 1, headCols + 4), 80);
  const inner = total - 2;
  const padLeft = Math.floor((inner - headCols) / 2);
  const padRight = inner - headCols - padLeft;
  const body = `${" ".repeat(padLeft)}${head}${" ".repeat(padRight)}`;

  const [tl, tr, bl, br, bar] = isAscii ? ["+", "+", "+", "+", "|"] : ["╭", "╮", "╰", "╯", "│"];
  const edge = (l: string, r: string) => theme.fg(style.ruleColor, `${l}${rule.repeat(inner)}${r}`);

  let middle: string;
  if (style.banner) middle = theme.bgFill("customMessageBg", body);
  else if (style.chip)
    middle = `${" ".repeat(padLeft)}${theme.bgFill("customMessageBg", theme.fg("thinkingText", head))}${" ".repeat(padRight)}`;
  else middle = theme.fg("thinkingText", body);

  return [
    edge(tl, tr),
    `${theme.fg(style.ruleColor, bar)}${middle}${theme.fg(style.ruleColor, bar)}`,
    edge(bl, br),
  ];
}

/** 回答区前缀：整行宽上下横线夹住标签，装饰符号与思考侧同款；markdown 无法居中，块级元素间必有空行 */
function answerPrefix(): string {
  const deco = STYLES[styleId].deco;
  const label = deco ? `${deco.left} FINAL ANSWER ${deco.right}` : "FINAL ANSWER";
  return `───\n\n**${label}**\n\n───\n\n`;
}

const styleFile = () =>
  join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"), "zone-dividers.json");
const extension: ExtensionFactory = async (pi) => {
  try {
    const saved = JSON.parse(await readFile(styleFile(), "utf8")) as { style?: string };
    if (saved.style && saved.style in STYLES) styleId = saved.style as StyleId;
  } catch {
    /* 首次运行无配置文件，用默认样式 */
  }

  pi.on("message_end", (event) => {
    // AgentMessage 是宿主联合类型；本插件只依赖 role/timestamp/content 三个字段，逐项校验后再取类型。
    const message: unknown = event.message;
    if (typeof message !== "object" || message === null || !("role" in message)) return;
    if (
      message.role !== "assistant" ||
      !("timestamp" in message) ||
      typeof message.timestamp !== "number"
    )
      return;
    if (!("content" in message) || !Array.isArray(message.content)) return;
    remember(message as AssistantMessage); // 宿主 assistant 载荷，字段已校验
    // 只有真正含文本块的回复才会走到 text renderer；用它区分「还没轮到文本」与「设置未开」。
    for (const block of message.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string" &&
        block.text.trim()
      ) {
        sawTextBlock = true;
        break;
      }
    }
  });

  pi.registerAssistantThinkingRenderer((context, theme) => ({
    render(width: number): readonly string[] {
      const next = successor(lastAssistantStamp, context.contentIndex + 1);
      if (next?.kind === "thinking") return []; // 连续思考块之间不重复画线
      return renderThinkingRule(width, context.text.length, theme as ThemeLike);
    },
  }));

  // 回答区标签：纯 Markdown 前缀，不放 ANSI。思考块之后也加，两个边界都显式可见。
  pi.registerAssistantTextRenderer((context) => {
    textRendererRan = true;
    const text = context.text;
    if (!text.trim()) return undefined;
    const prefix = answerPrefix();
    if (text.startsWith(prefix)) return undefined; // 幂等
    return `${prefix}${text}`;
  });

  pi.registerCommand("zone-style", {
    description: "切换转录分区样式（S1–S8）",
    handler: async (_args, ctx) => {
      const ids = Object.keys(STYLES) as StyleId[];
      const picked = await ctx.ui.select(
        `分区样式（当前 ${styleId}）`,
        ids.map((id) => `${STYLES[id].name}${id === styleId ? "（当前）" : ""}`),
      );
      if (!picked) return; // 取消：保持原样
      const next = ids.find((id) => picked.startsWith(id));
      if (!next) return;
      styleId = next; // 内存先生效，后续渲染立即采用
      try {
        await writeFile(styleFile(), `${JSON.stringify({ style: next }, null, 2)}\n`);
        ctx.ui.notify(`zone-dividers：样式已切换为 ${next}`, "info");
      } catch (error) {
        ctx.ui.notify(
          `zone-dividers：本次会话使用 ${next}，写配置失败（${String(error)}），重启后回到 ${DEFAULT_STYLE}`,
          "warning",
        );
      }
    },
  });

  pi.on("turn_end", (_event, ctx) => {
    // turn_end 每步都触发；只有「已经出过文本块，renderer 却一次没跑」才说明开关没开。
    if (warned || textRendererRan || !sawTextBlock || !ctx.hasUI) return;
    warned = true;
    ctx.ui.notify(
      "zone-dividers：回答区标签需要设置 extensionRenderers.assistantText=true（已写入 config.yml，重启 omp 生效）",
      "warning",
    );
  });
};

export default extension;
