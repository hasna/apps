import { For, Show, createSignal, onMount } from "solid-js";
import { TextAttributes, type MouseEvent } from "@opentui/core";
import {
  MAIL_CATEGORY_LABELS,
  getTenantContext,
  isMailCategoryLabel,
  labelDisplayName,
  labelNameAliases,
  labelNameKey,
  mailboxLabel,
  type Mailbox,
} from "../../tui/data.js";
import { MAILBOXES, useEmails } from "../context/emails-state.js";
import { labelColor, selectedForeground, useTheme } from "../context/theme.js";
import { Button, Row, SectionHeader } from "../ui/primitives.js";

const SIDEBAR_WIDE = 34;
const SYSTEM_LABEL_KEYS = new Set(["inbox", "sent", "spam", "trash", "unread", "starred", "archived", "draft", "drafts"]);

export function sidebarWidth(terminalWidth: number): number {
  return terminalWidth >= 92 ? SIDEBAR_WIDE : Math.min(34, Math.max(28, Math.floor(terminalWidth * 0.42)));
}

function CountText(props: { value: number; selected?: boolean; lowerBound?: boolean }) {
  const theme = useTheme();
  // O15-00350: a truncated self-hosted scan reports lower bounds (countsComplete
  // false); rendering them as exact totals re-creates the collapse the scan was
  // made honest to prevent. `≥` matches the CLI formatters (renderStatusCount).
  return <text fg={props.selected ? selectedForeground(theme, theme.primary) : theme.textMuted}>{props.lowerBound ? `≥${props.value}` : String(props.value)}</text>;
}

export function Sidebar() {
  const theme = useTheme();
  const emails = useEmails();
  const [open, setOpen] = createSignal({ mail: true, categories: true, labels: true, saved: true, tools: true });
  // Active organization, derived server-side from the credential (GET /v1/me).
  // Fetched after mount so the synchronous transport never blocks first paint;
  // stays empty when the caller is not signed in or the server is unreachable.
  const [org, setOrg] = createSignal<string>("");
  onMount(() => {
    try {
      const ctx = getTenantContext();
      if (ctx.identity) setOrg(ctx.label);
    } catch {
      // Header simply omits the org line when identity is unavailable.
    }
  });
  const counts = () => emails.state.counts;
  const mailboxCount = (box: Mailbox) => counts()[box] ?? 0;
  const activeLabel = (label: string) => !!emails.state.activeLabel && labelNameKey(emails.state.activeLabel) === labelNameKey(label);
  const labelCount = (label: string) => {
    const aliases = new Set(labelNameAliases(label));
    return emails.state.labels.reduce((sum, item) => sum + (aliases.has(item.name) ? item.count : 0), 0);
  };
  const labelRows = () => emails.state.labels
    .filter((label) => !isMailCategoryLabel(label.name) && !SYSTEM_LABEL_KEYS.has(labelNameKey(label.name)))
    .slice(0, 4);

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.backgroundPanel} paddingTop={1} paddingLeft={1} paddingRight={1}>
      <box
        height={org() ? 2 : 1}
        flexShrink={0}
        flexDirection="column"
        paddingLeft={1}
        onMouseUp={(event: MouseEvent) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          emails.actions.openDialog("address");
        }}
      >
        <box width="100%" flexDirection="row">
          <text fg={theme.text} attributes={TextAttributes.BOLD} flexShrink={1} wrapMode="none">{emails.state.selectedAddressId === "all" ? "All mailboxes" : emails.selectedAddress().label}</text>
          <text fg={theme.textMuted} flexShrink={0}> ▾</text>
        </box>
        <Show when={org()}>
          <text fg={theme.textMuted}>{org()}</text>
        </Show>
      </box>

      <box width="100%" marginTop={1} flexShrink={0}>
        <Button label="+ Compose" tone="primary" onPress={() => emails.actions.startCompose("new")} />
      </box>
      <scrollbox flexGrow={1} minHeight={0} width="100%" scrollX={false} verticalScrollbarOptions={{ trackOptions: { backgroundColor: theme.backgroundElement, foregroundColor: theme.borderActive } }}>
      <SectionHeader label={open().mail ? "Mail" : "Mail +"} onPress={() => setOpen((value) => ({ ...value, mail: !value.mail }))} />
      <Show when={open().mail}>
        <For each={MAILBOXES}>
          {(box) => {
            const active = () => emails.state.mailbox === box && emails.state.route === "mailbox";
            const fg = () => active() ? selectedForeground(theme, theme.primary) : theme.text;
            return (
            <Row active={active()} onPress={() => emails.actions.setMailbox(box)}>
              <box flexDirection="row" justifyContent="space-between" width="100%">
                <text fg={fg()} attributes={box === "unread" && mailboxCount(box) > 0 ? TextAttributes.BOLD : 0}>
                  {mailboxLabel(box)}
                </text>
                <CountText value={mailboxCount(box)} selected={active()} lowerBound={!emails.state.counts.countsComplete} />
              </box>
            </Row>
          );
          }}
        </For>
      </Show>

      <SectionHeader label={open().categories ? "Categories" : "Categories +"} onPress={() => setOpen((value) => ({ ...value, categories: !value.categories }))} />
      <Show when={open().categories}>
        <For each={MAIL_CATEGORY_LABELS}>
          {(category) => {
            const active = () => activeLabel(category.name);
            const fg = () => active() ? selectedForeground(theme, theme.primary) : theme.text;
            return (
              <Row active={active()} onPress={() => emails.actions.filterLabel(category.name)}>
                <box flexDirection="row" width="100%" columnGap={1}>
                  <text fg={active() ? fg() : labelColor(theme, category.name)}>■</text>
                  <box flexGrow={1}>
                    <text fg={fg()}>{category.title}</text>
                  </box>
                  <CountText value={labelCount(category.name)} selected={active()} />
                </box>
              </Row>
            );
          }}
        </For>
      </Show>

      <SectionHeader label={open().labels ? "Labels" : "Labels +"} onPress={() => setOpen((value) => ({ ...value, labels: !value.labels }))} />
      <Show when={open().labels}>
        <For each={labelRows()}>
          {(label) => {
            const active = () => activeLabel(label.name);
            const fg = () => active() ? selectedForeground(theme, theme.primary) : theme.text;
            return (
              <Row active={active()} onPress={() => emails.actions.filterLabel(label.name)}>
                <box flexDirection="row" width="100%" columnGap={1}>
                  <text fg={active() ? fg() : labelColor(theme, label.name)}>■</text>
                  <box flexGrow={1}>
                    <text fg={fg()}>{labelDisplayName(label.name)}</text>
                  </box>
                  <CountText value={label.count} selected={active()} />
                </box>
              </Row>
            );
          }}
        </For>
      </Show>

      <SectionHeader label={open().saved ? "Saved Filters" : "Saved Filters +"} onPress={() => setOpen((value) => ({ ...value, saved: !value.saved }))} />
      <Show when={open().saved}>
        <For each={emails.state.savedFilters}>
          {(filter) => {
            const active = () => emails.state.activeFilterId === filter.id;
            return (
              <Row active={active()} onPress={() => void emails.actions.applySavedFilter(filter.id)}>
                <box flexDirection="row" width="100%" justifyContent="space-between">
                  <text fg={active() ? selectedForeground(theme, theme.primary) : theme.text}>{filter.name}</text>
                  <text fg={active() ? selectedForeground(theme, theme.primary) : theme.textMuted}>{filter.mailbox}</text>
                </box>
              </Row>
            );
          }}
        </For>
        <Row active={emails.state.dialog === "saved-filters"} onPress={() => emails.actions.openDialog("saved-filters")}>
          <text fg={emails.state.dialog === "saved-filters" ? selectedForeground(theme, theme.primary) : theme.text}>Manage saved filters</text>
        </Row>
      </Show>

      <SectionHeader label={open().tools ? "Actions" : "Actions +"} onPress={() => setOpen((value) => ({ ...value, tools: !value.tools }))} />
      <Show when={open().tools}>
        <Row active={emails.state.dialog === "commands"} onPress={() => emails.actions.openDialog("commands")}>
          <text fg={emails.state.dialog === "commands" ? selectedForeground(theme, theme.primary) : theme.text}>Shortcuts</text>
        </Row>
        <Row active={emails.state.dialog === "domains"} onPress={() => emails.actions.openDialog("domains")}>
          <text fg={emails.state.dialog === "domains" ? selectedForeground(theme, theme.primary) : theme.text}>Domains</text>
        </Row>
      </Show>

      </scrollbox>
      <box height={2} flexShrink={0} flexDirection="column" paddingLeft={1}>
        <box height={1} width="100%" flexDirection="row" justifyContent="space-between">
          <Button label="Settings" onPress={() => emails.actions.openDialog("settings")} />
          <text fg={theme.textMuted}>{emails.state.loading ? "Loading" : "Ready"}</text>
        </box>
        <Show when={emails.state.lastError}>
          <text fg={theme.error}>{emails.state.lastError}</text>
        </Show>
      </box>

    </box>
  );
}
