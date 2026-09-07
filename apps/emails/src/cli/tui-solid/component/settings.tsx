import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { TextAttributes, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { useEmails } from "../context/emails-state.js";
import { useTheme } from "../context/theme.js";
import { useToast } from "../context/toast.js";
import { Button, Row } from "../ui/primitives.js";
import { addPrioritySenderRule, listPrioritySenderRules, removePrioritySenderRule } from "../../tui/data.js";
import { normalizePriorityRuleInput, type PrioritySenderRule, type PrioritySenderRuleKind } from "../../../lib/priority-senders.js";

const SECTIONS = ["General", "Appearance", "Reading", "Priority Inbox", "Shortcuts"] as const;
type SettingsSection = typeof SECTIONS[number];
type SettingRow = { title: string; detail: string; value: string; change: () => void };
const SHORTCUTS = [
  ["Search mail", "Ctrl+F"], ["Refresh mailbox", "Ctrl+R"], ["Command palette", "Ctrl+P"],
  ["Select a message", "↑ / ↓"], ["Open selected message", "Enter / →"],
  ["Scroll a message", "↑ / ↓ · PgUp / PgDn"], ["Focus expandable section", "Tab / Shift+Tab"],
  ["Expand or collapse section", "Enter / Space"], ["Close dialog or go back", "Esc"],
];

export function SettingsDialog(props: { close: () => void }) {
  const emails = useEmails();
  const theme = useTheme();
  const dimensions = useTerminalDimensions();
  const [section, setSection] = createSignal<SettingsSection>("General");
  const [rowIndex, setRowIndex] = createSignal(-1);
  let scroll: ScrollBoxRenderable | undefined;
  const rowHandles = new Map<number, BoxRenderable>();
  const narrow = () => dimensions().width < 95;
  const changeSection = (next: SettingsSection) => {
    setSection(next);
    setRowIndex(-1);
    scroll?.scrollTo(0);
  };
  const toggle = (value: boolean) => value ? "● On" : "○ Off";
  const rows = createMemo<SettingRow[]>(() => {
    const settings = emails.state.settings;
    const view = emails.state.viewPreferences;
    switch (section()) {
      case "General": return [
        { title: "Refresh automatically", detail: "Check for new mail every 30 seconds.", value: toggle(view.autoRefresh), change: () => emails.actions.setViewPreference("autoRefresh", !view.autoRefresh) },
        { title: "Current mailbox", detail: "Choose one mailbox or see all your mail.", value: "Choose ›", change: () => { props.close(); emails.actions.openDialog("address"); } },
      ];
      case "Appearance": return [
        { title: "Color scheme", detail: "Choose a light, dark, or system appearance.", value: settings.theme === "auto" ? "System ▾" : settings.theme === "light" ? "Light ▾" : "Dark ▾", change: () => emails.actions.setSetting("theme", settings.theme === "light" ? "dark" : settings.theme === "dark" ? "auto" : "light") },
        { title: "Dim read messages", detail: "Keep unread messages easier to spot.", value: toggle(settings.dimRead), change: () => emails.actions.setSetting("dimRead", !settings.dimRead) },
      ];
      case "Reading": return [
        { title: "Expand code blocks", detail: "Show code by default when opening mail.", value: toggle(view.expandCode), change: () => emails.actions.setViewPreference("expandCode", !view.expandCode) },
        { title: "Expand quoted messages", detail: "Show earlier replies by default.", value: toggle(view.expandQuotes), change: () => emails.actions.setViewPreference("expandQuotes", !view.expandQuotes) },
      ];
      default: return [];
    }
  });
  const focusRow = (index: number) => {
    setRowIndex(index);
    const row = rowHandles.get(index);
    if (row && scroll) {
      const top = row.y - scroll.viewport.y;
      if (top < 0) scroll.scrollBy(top);
      else if (top + row.height > scroll.viewport.height) scroll.scrollBy(top + row.height - scroll.viewport.height);
    }
  };
  const nextSection = (delta: number) => changeSection(SECTIONS[(SECTIONS.indexOf(section()) + delta + SECTIONS.length) % SECTIONS.length]!);
  useKeyboard((key) => {
    if (key.name === "escape") props.close();
    else if (key.ctrl && (key.name === "left" || key.name === "right")) nextSection(key.name === "left" ? -1 : 1);
    else if (section() === "Priority Inbox" || key.ctrl || key.meta || key.option) return;
    else if (key.name === "tab") {
      if (!rows().length) nextSection(key.shift ? -1 : 1);
      else focusRow(((rowIndex() + 1 + (key.shift ? -1 : 1) + rows().length + 1) % (rows().length + 1)) - 1);
    } else if (key.name === "left" || key.name === "right") nextSection(key.name === "left" ? -1 : 1);
    else if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      if (rowIndex() < 0) nextSection(delta);
      else focusRow((rowIndex() + delta + rows().length) % rows().length);
    } else if (key.name === "enter" || key.name === "return" || key.name === "space") {
      if (rowIndex() < 0 && rows().length) focusRow(0);
      else rows()[rowIndex()]?.change();
    } else if (key.name === "pageup" || key.name === "pagedown") scroll?.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(1, (scroll?.viewport.height ?? 10) - 2));
    else return;
    key.preventDefault();
    key.stopPropagation();
  });

  return (
    <box width="100%" height={Math.max(12, Math.min(28, dimensions().height - 8))} flexDirection="column">
      <box flexDirection="row" width="100%" height={2} flexShrink={0} justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>Settings</text>
        <Button label="Close" onPress={props.close} />
      </box>
      <box width="100%" flexGrow={1} minHeight={0} flexDirection="row" columnGap={narrow() ? 1 : 3}>
        <box width={narrow() ? 17 : 21} flexShrink={0} flexDirection="column" rowGap={1}>
          <text fg={theme.textMuted}>Preferences</text>
          <For each={SECTIONS}>
            {(name) => (
              <box width="100%" height={1} paddingLeft={1}
                backgroundColor={section() === name ? theme.backgroundActive : undefined}
                onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); changeSection(name); }}>
                <text fg={section() === name ? theme.primary : theme.text} attributes={section() === name ? TextAttributes.BOLD : 0}>
                  {section() === name && rowIndex() < 0 ? "› " : "  "}{name}
                </text>
              </box>
            )}
          </For>
          <box flexGrow={1} />
          <text fg={theme.textMuted}>Hasna Emails</text>
        </box>
        <scrollbox ref={(value) => { scroll = value; }} flexGrow={1} flexShrink={1} minHeight={0} scrollX={false}
          verticalScrollbarOptions={{ trackOptions: { backgroundColor: theme.backgroundElement, foregroundColor: theme.borderActive } }}
          contentOptions={{ flexDirection: "column", flexShrink: 0 }}>
          <text fg={theme.text} attributes={TextAttributes.BOLD} marginBottom={1}>{section()}</text>
          <For each={rows()}>
            {(row, index) => (
              <box ref={(value) => rowHandles.set(index(), value)} width="100%" flexDirection="column" flexShrink={0}
                paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} border={["bottom"]} borderColor={theme.borderSubtle}
                backgroundColor={rowIndex() === index() ? theme.backgroundActive : theme.backgroundPanel}
                onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); focusRow(index()); row.change(); }}>
                <box width="100%" flexDirection="row" columnGap={1}>
                  <text fg={theme.text} flexGrow={1} flexShrink={1} attributes={TextAttributes.BOLD} wrapMode="word">{row.title}</text>
                  <text fg={rowIndex() === index() ? theme.primary : theme.text} flexShrink={0}>{row.value}</text>
                </box>
                <text fg={theme.textMuted} wrapMode="word">{row.detail}</text>
              </box>
            )}
          </For>
          <Show when={section() === "General"}>
            <text fg={theme.textMuted} wrapMode="word" marginTop={1}>Viewing {emails.selectedAddress().id === "all" ? "all mailboxes" : emails.selectedAddress().label}.</text>
          </Show>
          <Show when={section() === "Reading"}>
            <text fg={theme.textMuted} wrapMode="word" marginTop={1}>Click any section header to expand or collapse it while reading.</text>
          </Show>
          <Show when={section() === "Priority Inbox"}><PriorityRulesSettings /></Show>
          <Show when={section() === "Shortcuts"}>
            <For each={SHORTCUTS}>
              {(shortcut) => (
                <box width="100%" flexDirection="row" flexShrink={0} columnGap={1} padding={1} border={["bottom"]} borderColor={theme.borderSubtle} backgroundColor={theme.backgroundPanel}>
                  <text fg={theme.text} flexGrow={1} flexShrink={1} wrapMode="word">{shortcut[0]}</text>
                  <text fg={theme.textMuted} flexShrink={0}>{shortcut[1]}</text>
                </box>
              )}
            </For>
          </Show>
        </scrollbox>
      </box>
      <text fg={theme.textMuted} flexShrink={0} marginTop={1} wrapMode="word">
        {section() === "Priority Inbox" ? "Priority rules are saved to your account." : section() === "Shortcuts" ? "Single-letter shortcuts are off while typing." : "View preferences apply until you close Emails."}
      </text>
      <text fg={theme.textMuted} flexShrink={0} wrapMode="word">{section() === "Priority Inbox" ? "Enter Add · Ctrl+←/→ Sections · Esc Close" : "Ctrl+←/→ Sections · Tab Controls · Esc Close"}</text>
    </box>
  );
}
function PriorityRulesSettings() {
  const theme = useTheme();
  const toast = useToast();
  const [kind, setKind] = createSignal<PrioritySenderRuleKind>("address");
  const [value, setValue] = createSignal("");
  const [rules, setRules] = createSignal<PrioritySenderRule[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  const refresh = () => {
    try {
      setRules(listPrioritySenderRules() as PrioritySenderRule[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  onMount(refresh);

  const addRule = () => {
    try {
      const normalized = normalizePriorityRuleInput(kind(), value());
      addPrioritySenderRule(normalized.kind, normalized.value);
      setValue("");
      setError(null);
      refresh();
      toast.show({ title: "Priority rule saved", message: `${normalized.kind}: ${normalized.value}`, tone: "success" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const removeRule = (rule: PrioritySenderRule) => {
    try {
      removePrioritySenderRule(rule.id);
      refresh();
      toast.show({ title: "Priority rule removed", message: `${rule.kind}: ${rule.value}`, tone: "success" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <box flexDirection="column" width="100%" rowGap={1}>
      <text fg={theme.textMuted}>Rules match inbound senders case-insensitively. Addresses match exactly; domains match the sender domain.</text>
      <box flexDirection="row" columnGap={1}>
        <Button label="Exact address" active={kind() === "address"} onPress={() => setKind("address")} />
        <Button label="Sender domain" active={kind() === "domain"} onPress={() => setKind("domain")} />
      </box>
      <input
        focused flexShrink={0} backgroundColor={theme.backgroundPanel} textColor={theme.text}
        value={value()}
        placeholder={kind() === "address" ? "person@example.com" : "example.com"}
        onInput={(next) => setValue(next)}
        onSubmit={addRule}
      />
      <Show when={value().trim()}><Button label="Add priority rule" tone="primary" onPress={addRule} /></Show>
      <Show when={error()}>
        {(message) => <text fg={theme.error}>Validation failed: {message()}</text>}
      </Show>
      <text fg={theme.text}>Current rules ({rules().length})</text>
      <Show when={rules().length > 0} fallback={<text fg={theme.textMuted}>No priority sender rules.</text>}>
        <box flexDirection="column" width="100%" flexShrink={0}>
          <For each={rules()}>
            {(rule) => (
              <Row>
                <box flexDirection="row" width="100%" justifyContent="space-between">
                  <text fg={theme.text} flexGrow={1} flexShrink={1} wrapMode="none">★ {rule.kind === "address" ? "Address" : "Domain"}: {rule.value}</text>
                  <Button label="Remove" onPress={() => removeRule(rule)} />
                </box>
              </Row>
            )}
          </For>
        </box>
      </Show>
    </box>
  );
}
