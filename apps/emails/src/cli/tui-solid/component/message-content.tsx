import { For, Show, createContext, createEffect, createMemo, createSignal, onCleanup, useContext, type ParentProps } from "solid-js";
import { SyntaxStyle, StyledText, TextRenderable, TextAttributes, infoStringToFiletype, type TextChunk, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { marked, type Token } from "marked";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { messageDocument, safeMailLink, safeMailText, type MessageBlock } from "../../tui/message-document.js";
import { useTheme } from "../context/theme.js";
import { useEmails } from "../context/emails-state.js";

type DisclosureHandle = { header: BoxRenderable; toggle: () => void };
const ReaderControls = createContext<{
  register: (handle: DisclosureHandle) => () => void;
  focused: () => DisclosureHandle | undefined;
  focus: (handle: DisclosureHandle) => void;
  reveal: (handle: DisclosureHandle) => void;
}>();

export function ReaderControlsProvider(props: ParentProps<{ scroll: () => ScrollBoxRenderable | undefined; enabled: boolean }>) {
  const handles = new Set<DisclosureHandle>();
  const [focused, focus] = createSignal<DisclosureHandle>();
  useKeyboard((key) => {
    if (!props.enabled || key.ctrl || key.meta || key.option) return;
    const scroll = props.scroll();
    if (!scroll) return;
    if (key.name === "tab") {
      const ordered = [...handles].sort((a, b) => a.header.y - b.header.y);
      if (!ordered.length) return;
      const index = ordered.indexOf(focused()!);
      const next = ordered[index < 0 ? (key.shift ? ordered.length - 1 : 0) : (index + (key.shift ? -1 : 1) + ordered.length) % ordered.length]!;
      focus(next);
      const top = next.header.y - scroll.viewport.y;
      if (top < 0) scroll.scrollBy(top);
      else if (top >= scroll.viewport.height) scroll.scrollBy(top - scroll.viewport.height + 1);
    } else if (key.name === "return" || key.name === "enter" || key.name === "space") {
      if (!focused()) return;
      focused()!.toggle();
    } else if (key.name === "up" || key.name === "down") {
      scroll.scrollBy(key.name === "up" ? -1 : 1);
    } else if (key.name === "pageup" || key.name === "pagedown") {
      scroll.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(1, scroll.viewport.height - 2));
    } else if (key.name === "home" || key.name === "end") {
      scroll.scrollTo(key.name === "home" ? 0 : scroll.scrollHeight);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  });
  const controls = {
    register(handle: DisclosureHandle) {
      handles.add(handle);
      return () => { handles.delete(handle); if (focused() === handle) focus(undefined); };
    },
    focused,
    focus,
    reveal(handle: DisclosureHandle) {
      const scroll = props.scroll();
      if (!scroll) return;
      const offset = handle.header.y - scroll.viewport.y;
      const limit = Math.max(0, scroll.viewport.height - 6);
      if (offset > limit) scroll.scrollBy(offset - limit);
    },
  };
  return <ReaderControls.Provider value={controls}>{props.children}</ReaderControls.Provider>;
}

export function Disclosure(props: ParentProps<{ label: string; detail?: string; initiallyOpen?: boolean; expanded?: boolean }>) {
  const theme = useTheme();
  const renderer = useRenderer();
  const controls = useContext(ReaderControls);
  const [open, setOpen] = createSignal(props.initiallyOpen ?? false);
  createEffect(() => { if (props.expanded !== undefined) setOpen(props.expanded); });
  let handle: DisclosureHandle;
  let reveal = false;
  const toggle = () => { const next = !open(); reveal = next; setOpen(next); };
  const active = () => controls?.focused() === handle;
  return (
    <box flexDirection="column" width="100%" flexShrink={0} marginBottom={1}
      renderAfter={() => { if (reveal) { reveal = false; controls?.reveal(handle); } }}>
      <box
        ref={(header) => {
          handle = { header, toggle };
          onCleanup(controls?.register(handle) ?? (() => {}));
        }}
        width="100%" height={1} flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1} columnGap={1}
        backgroundColor={active() ? theme.backgroundActive : theme.backgroundElement}
        onMouseUp={(event) => {
          if (event.button !== 0 || renderer.getSelection()?.getSelectedText()) return;
          event.stopPropagation();
          controls?.focus(handle);
          toggle();
        }}
      >
        <text fg={active() ? theme.primary : theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>{open() ? "▾ " : "▸ "}</text>
        <text fg={theme.text} wrapMode="none" flexGrow={1} flexShrink={1}>{safeMailText(props.label)}</text>
        <Show when={props.detail}><text fg={theme.textMuted} wrapMode="none" flexShrink={0}>{props.detail}</text></Show>
      </box>
      <Show when={open()}>
        <box flexDirection="column" width="100%" flexShrink={0} paddingTop={1} paddingLeft={1}>
          {props.children}
        </box>
      </Show>
    </box>
  );
}

function Blocks(props: { blocks: MessageBlock[]; syntax: SyntaxStyle }) {
  const emails = useEmails();
  const theme = useTheme();
  const renderer = useRenderer();
  // Use OpenTUI's custom-node API for immediate, selectable prose. The default
  // Markdown code renderer waits for an asynchronous grammar, even for plain mail.
  // Tables and other block layout still use the built-in Markdown renderer.
  const prose = (token: Token) => {
    if (!["paragraph", "text", "heading"].includes(token.type)) return undefined;
    const chunks: TextChunk[] = [];
    const heading = token.type === "heading";
    const initial = { fg: props.syntax.getStyle(heading ? "markup.heading" : "default")?.fg, attributes: heading ? TextAttributes.BOLD : 0 };
    const inline = (tokens: Token[], style: Pick<TextChunk, "fg" | "attributes" | "link">) => {
      for (const part of tokens) {
        let next = { ...style };
        if (part.type === "strong") next.attributes = (next.attributes ?? 0) | TextAttributes.BOLD;
        if (part.type === "em") next.attributes = (next.attributes ?? 0) | TextAttributes.ITALIC;
        if (part.type === "del") next.attributes = (next.attributes ?? 0) | TextAttributes.STRIKETHROUGH;
        if (part.type === "codespan") next.fg = props.syntax.getStyle("markup.raw")?.fg;
        if (part.type === "link") {
          const href = safeMailLink(part.href);
          if (href) {
            next.fg = props.syntax.getStyle("markup.link.label")?.fg;
            next.attributes = (next.attributes ?? 0) | TextAttributes.UNDERLINE;
            next.link = { url: href };
          }
        }
        if ("tokens" in part && Array.isArray(part.tokens)) inline(part.tokens, next);
        else {
          const text = part.type === "br" ? "\n" : part.type === "image" ? `[Image: ${part.text || "image"}]`
            : "text" in part && typeof part.text === "string" ? part.text : part.raw;
          chunks.push({ __isChunk: true, text: safeMailText(text), ...next });
        }
      }
    };
    inline("tokens" in token && Array.isArray(token.tokens) ? token.tokens : marked.lexer("text" in token ? String(token.text) : token.raw), initial);
    return new TextRenderable(renderer, { content: new StyledText(chunks), width: "100%", flexShrink: 0, wrapMode: "word", marginTop: 1 });
  };
  return (
    <For each={props.blocks}>
      {(block) => {
        if (block.kind === "code") return (
          <Disclosure expanded={emails.state.viewPreferences.expandCode} label={block.language ? `Code · ${block.language}` : "Code"} detail={`${block.content.split("\n").length} lines`}>
            <code content={block.content} filetype={infoStringToFiletype(block.language) || "text"} syntaxStyle={props.syntax}
              fg={theme.markdownCodeBlock} bg={theme.background} conceal={false} drawUnstyledText streaming={false}
              wrapMode="word" width="100%" flexShrink={0} />
          </Disclosure>
        );
        if (block.kind === "quote") return (
          <Disclosure expanded={emails.state.viewPreferences.expandQuotes} label="Quoted message" detail="Show / hide">
            <MessageContent text={block.content} />
          </Disclosure>
        );
        if (block.kind === "list") return (
          <box width="100%" flexDirection="column" flexShrink={0} marginBottom={1}>
            <For each={block.items}>
              {(item) => (
                <box width="100%" flexDirection="row" flexShrink={0} columnGap={1}>
                  <text fg={theme.markdownListItem} flexShrink={0}>{item.marker}</text>
                  <box flexGrow={1} flexShrink={1} flexDirection="column"><Blocks blocks={item.blocks} syntax={props.syntax} /></box>
                </box>
              )}
            </For>
          </box>
        );
        return <markdown content={block.content} syntaxStyle={props.syntax} conceal streaming={false}
          // 0.4.1's coalesced style refresh replaces custom nodes with code nodes.
          // Top-level mode preserves our immediate prose renderer across refreshes.
          internalBlockMode="top-level"
          renderNode={prose}
          fg={theme.markdownText} width="100%" flexShrink={0} marginBottom={1}
          tableOptions={{ style: "grid", widthMode: "full", columnFitter: "balanced", wrapMode: "word", cellPaddingX: 1, cellPaddingY: 0, borderColor: theme.border }} />;
      }}
    </For>
  );
}

export function MessageContent(props: { text?: string | null; html?: string | null }) {
  const theme = useTheme();
  const blocks = createMemo(() => messageDocument(props.text, props.html));
  const syntax = createMemo(() => {
    const style = SyntaxStyle.fromStyles({
      default: { fg: theme.markdownText },
      "markup.heading": { fg: theme.markdownHeading, bold: true },
      "markup.strong": { fg: theme.markdownStrong, bold: true },
      "markup.italic": { fg: theme.markdownEmph, italic: true },
      "markup.link": { fg: theme.markdownLink },
      "markup.link.label": { fg: theme.markdownLinkText, underline: true },
      "markup.link.url": { fg: theme.markdownLink },
      "markup.raw": { fg: theme.markdownCode },
      "markup.list": { fg: theme.markdownListItem },
      "markup.quote": { fg: theme.markdownBlockQuote },
      keyword: { fg: theme.accent, bold: true },
      string: { fg: theme.success },
      comment: { fg: theme.textMuted, italic: true },
      function: { fg: theme.secondary },
      number: { fg: theme.warning },
    });
    onCleanup(() => style.destroy());
    return style;
  });
  return <box width="100%" flexDirection="column" flexShrink={0}><Blocks blocks={blocks()} syntax={syntax()} /></box>;
}
