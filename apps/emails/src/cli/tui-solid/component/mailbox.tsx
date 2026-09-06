import { For, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { useEmails } from "../context/emails-state.js";
import { labelColor, selectedForeground, useTheme } from "../context/theme.js";
import { Button, EmptyState, Row } from "../ui/primitives.js";
import { listDateTime, senderName, truncate } from "../../tui/format.js";
import { isImportantMessage, labelDisplayName, mailboxGroupModeLabel } from "../../tui/data.js";
import { sidebarWidth } from "./sidebar.js";

interface MailboxColumns {
  from: number;
  subject: number;
  date: number;
}

function MessageRow(props: { message: ReturnType<typeof useEmails>["state"]["messages"][number]; selected: boolean; columns: MailboxColumns }) {
  const theme = useTheme();
  const emails = useEmails();
  const message = () => props.message;
  const unread = () => !message().is_read;
  const rowBg = () => props.selected ? theme.primary : undefined;
  const rowFg = () => props.selected ? selectedForeground(theme, rowBg()) : theme.text;
  const dateText = () => listDateTime(message().date, emails.state.now).padStart(props.columns.date);

  return (
    <Row active={props.selected} onPress={() => emails.actions.selectMessage(message().id)}>
      <box flexDirection="row" width="100%" columnGap={1} backgroundColor={rowBg()}>
        <box width={2} flexShrink={0}>
          <Show when={isImportantMessage(message())}>
            <text fg={props.selected ? rowFg() : theme.warning}>{message().is_priority ? "★" : "■"}</text>
          </Show>
        </box>
        <box width={props.columns.from} flexShrink={0}>
          <text fg={rowFg()} attributes={unread() ? TextAttributes.BOLD : 0}>
            {truncate(senderName(message().from), props.columns.from)}
          </text>
        </box>
        <box width={props.columns.subject} flexShrink={0}>
          <text fg={rowFg()}>
            <span style={{ bold: unread() }}>{truncate(message().subject || "(no subject)", props.columns.subject)}</span>
            <span style={{ fg: props.selected ? rowFg() : theme.textMuted }}>{(message().subject || "(no subject)").length + 4 < props.columns.subject ? ` — ${truncate(message().snippet.replace(/\s+/g, " "), props.columns.subject - (message().subject || "(no subject)").length - 3)}` : ""}</span>
          </text>
        </box>
        <box width={props.columns.date} flexShrink={0}>
          <text fg={props.selected ? rowFg() : theme.textMuted}>{truncate(dateText(), props.columns.date)}</text>
        </box>
      </box>
    </Row>
  );
}

export function MailboxRoute() {
  const theme = useTheme();
  const emails = useEmails();
  const dimensions = useTerminalDimensions();
  const contentWidth = () => Math.max(24, dimensions().width - sidebarWidth(dimensions().width) - 6);
  const emptyDetail = () => {
    if (emails.state.search && emails.state.activeLabel) return "No messages match this search and label.";
    if (emails.state.search) return "No messages match this search.";
    if (emails.state.activeLabel) return `No messages match ${labelDisplayName(emails.state.activeLabel)}.`;
    return "Choose another mailbox or refresh to check for new messages.";
  };
  const columns = (): MailboxColumns => {
    const width = contentWidth();
    const date = width < 45 ? 9 : 10;
    const from = Math.max(10, Math.min(22, Math.floor(width * 0.25)));
    return { from, date, subject: Math.max(4, width - from - date - 5) };
  };

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background} paddingTop={1} paddingLeft={2} paddingRight={2}>
      <box width="100%" height={1} flexShrink={0} flexDirection="row" columnGap={1}>
        <box flexGrow={1} flexShrink={1} paddingLeft={1} backgroundColor={theme.backgroundElement}
          onMouseUp={(event) => { if (event.button !== 0) return; event.stopPropagation(); emails.actions.openDialog("search"); }}>
          <text fg={theme.textMuted} wrapMode="none">{emails.state.search ? `Search mail: ${emails.state.search}` : "Search mail  (Ctrl+F)"}</text>
        </box>
        <Button label="Filter" active={!!emails.state.search || !!emails.state.activeLabel || !!emails.state.activeFilterId || emails.state.mailbox !== "inbox" || emails.state.selectedSourceId !== "all"}
          onPress={() => emails.actions.openDialog("filter")} />
      </box>
      <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0} columnGap={1} rowGap={1} marginTop={1} marginBottom={1}>
        <Button label={emails.state.sort === "newest" ? "Newest first" : "Oldest first"} onPress={() => emails.actions.cycleSort()} />
        <Button label="Group" active={emails.state.groupMode !== "none"} onPress={() => emails.actions.openDialog("group")} />
        <Button label="Sources" active={emails.state.selectedSourceId !== "all"} onPress={() => emails.actions.openDialog("source")} />
        <Button label="Digest" onPress={() => emails.actions.openDialog("digest")} />
        <text fg={theme.textMuted}>Page {emails.state.page + 1}</text>
      </box>
      <Show when={emails.state.selectedSourceId !== "all"}>
        <text fg={theme.textMuted} flexShrink={0}>Source: {emails.selectedSource().label}</text>
      </Show>

      <box height={1} flexDirection="row" columnGap={1} paddingLeft={1}>
        <box width={2} flexShrink={0} />
        <box width={columns().from} flexShrink={0}>
          <text fg={theme.textMuted}>Sender</text>
        </box>
        <box width={columns().subject} flexShrink={0}>
          <text fg={theme.textMuted}>Subject / preview</text>
        </box>
        <box width={columns().date} flexShrink={0}>
          <text fg={theme.textMuted}>{"Date".padStart(columns().date)}</text>
        </box>
      </box>

      <Show
        when={emails.state.messages.length > 0}
        fallback={<EmptyState title="No messages" detail={emptyDetail()} />}
      >
        <scrollbox flexGrow={1} minHeight={0} width="100%" scrollX={false}>
          <For each={emails.groupedMessages()}>
            {(group) => (
              <>
                <Show when={emails.state.groupMode !== "none"}>
                  <box height={1} paddingLeft={1}>
                    <text fg={theme.textMuted}>{group.title}</text>
                  </box>
                </Show>
                <For each={group.messages}>
                  {(message) => <MessageRow message={message} selected={emails.state.selectedMessageId === message.id} columns={columns()} />}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>

      <Show when={emails.selectedMessage()}>
        <text fg={theme.textMuted} wrapMode="none" width="100%" flexShrink={0} marginTop={1} marginBottom={1}>To: {emails.selectedMessage()?.to}</text>
      </Show>
      <box flexDirection="row" flexWrap="wrap" width="100%" flexShrink={0} columnGap={1} rowGap={1}>
        <Button label="Previous page" onPress={() => emails.actions.page(-1)} />
        <Button label="Next page" active={emails.state.hasMore} onPress={() => emails.actions.page(1)} />
        <Button label="Open" onPress={() => emails.actions.openMessage()} />
	        <Button label="Label" onPress={() => emails.actions.openDialog("labels")} />
	        <Button label="Save filter" active={!!emails.state.activeFilterId} onPress={() => emails.actions.openDialog("save-filter")} />
      </box>
      <box height={1} flexDirection="row" columnGap={1}>
        <Show when={emails.state.search && !emails.state.activeFilterId}>
          <text fg={theme.textMuted}>Search: {emails.state.search}</text>
        </Show>
        <Show when={emails.state.activeLabel && !emails.state.activeFilterId}>
          <text fg={theme.textMuted}>Label: {labelDisplayName(emails.state.activeLabel!)}</text>
        </Show>
        <Show when={emails.state.activeFilterId}>
          <text fg={theme.primary}>Saved filter: {emails.state.savedFilters.find((item) => item.id === emails.state.activeFilterId)?.name ?? emails.state.activeFilterId}</text>
        </Show>
        <Show when={emails.state.groupMode !== "none"}>
          <text fg={theme.textMuted}>Group: {mailboxGroupModeLabel(emails.state.groupMode)}</text>
        </Show>
      </box>

      <box height={1} flexDirection="row" columnGap={1}>
        <For each={(emails.selectedMessage()?.labels ?? []).slice(0, 8)}>
          {(label) => (
            <box flexDirection="row" columnGap={1}>
              <text fg={labelColor(theme, label)}>■</text>
              <text fg={theme.textMuted}>{labelDisplayName(label)}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}
