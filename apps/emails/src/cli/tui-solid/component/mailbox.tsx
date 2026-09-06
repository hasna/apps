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
  const rowFg = () => props.selected ? selectedForeground(theme, rowBg()) : (!unread() && emails.state.settings.dimRead ? theme.textMuted : theme.text);
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
  const hasFilters = () => !!emails.state.search || !!emails.state.activeLabel || !!emails.state.activeFilterId || emails.state.selectedSourceId !== "all";
  const emptyTitle = () => {
    if (emails.state.loading) return "Checking your mail";
    if (emails.state.mailboxError) return "Couldn't load your mail";
    if (hasFilters()) return "No matching messages";
    if (emails.state.page > 0) return "No more messages";
    switch (emails.state.mailbox) {
      case "inbox": return "Your inbox is clear";
      case "unread": return "You're all caught up";
      case "starred": return "No starred messages";
      case "sent": return "No sent messages yet";
      case "archived": return "No archived messages";
      case "spam": return "No spam here";
      case "trash": return "Your trash is empty";
      default: return "No priority messages";
    }
  };
  const emptyDetail = () => {
    if (emails.state.loading) return "New messages will appear here.";
    if (emails.state.mailboxError) return "Check your connection and try again.";
    if (hasFilters()) return "Try a different search or clear your filters.";
    if (emails.state.page > 0) return "Return to the previous page to see your mail.";
    switch (emails.state.mailbox) {
      case "starred": return "Add the Starred label to keep important mail here.";
      case "sent": return "Start a conversation with a new message.";
      case "archived": return "Messages with the Archived label appear here.";
      case "priority": return "Mail from your priority senders will appear here.";
      default: return "Enjoy the quiet. New mail will appear here.";
    }
  };
  const emptyAction = () => {
    if (emails.state.mailboxError) return { label: "Try again", run: () => void emails.actions.reload() };
    if (hasFilters()) return { label: "Clear filters", run: emails.actions.clearFilters };
    if (emails.state.page > 0) return { label: "Previous page", run: () => emails.actions.page(-1) };
    if (emails.state.mailbox === "sent") return { label: "Write a message", run: () => emails.actions.startCompose("new") };
    return { label: "Check for new mail", run: () => void emails.actions.reload() };
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
      <Show when={emails.state.messages.length > 0}>
        <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0} columnGap={1} rowGap={1} marginTop={1} marginBottom={1}>
          <Button label={emails.state.sort === "newest" ? "Newest first" : "Oldest first"} onPress={() => emails.actions.cycleSort()} />
          <Button label="Group" active={emails.state.groupMode !== "none"} onPress={() => emails.actions.openDialog("group")} />
          <Show when={emails.state.sources.length > 1}><Button label="Sources" active={emails.state.selectedSourceId !== "all"} onPress={() => emails.actions.openDialog("source")} /></Show>
          <Button label="Digest" onPress={() => emails.actions.openDialog("digest")} />
          <Show when={emails.state.page > 0 || emails.state.hasMore}><text fg={theme.textMuted}>Page {emails.state.page + 1}</text></Show>
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

      </Show>
      <Show when={emails.state.messages.length > 0} fallback={
        <EmptyState fill icon={emails.state.mailboxError ? "!" : "╭──────╮\n│ ╲  ╱ │\n╰──────╯"} title={emptyTitle()} detail={emptyDetail()}>
          <Show when={!emails.state.loading}>
            <box flexDirection="row" flexWrap="wrap" justifyContent="center" columnGap={1} rowGap={1}>
              <Button label={emptyAction().label} tone="primary" onPress={() => emptyAction().run()} />
              <Button label="Switch mailbox" onPress={() => emails.actions.openDialog("address")} />
            </box>
          </Show>
        </EmptyState>
      }>
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
        <Show when={emails.state.messages.length > 0 && emails.state.page > 0}><Button label="Previous page" onPress={() => emails.actions.page(-1)} /></Show>
        <Show when={emails.state.hasMore}><Button label="Next page" onPress={() => emails.actions.page(1)} /></Show>
        <Show when={emails.selectedMessage()}>
          <Button label="Open" onPress={() => emails.actions.openMessage()} />
          <Button label="Label" onPress={() => emails.actions.openDialog("labels")} />
        </Show>
        <Show when={hasFilters() || emails.state.mailbox !== "inbox"}><Button label="Save filter" active={!!emails.state.activeFilterId} onPress={() => emails.actions.openDialog("save-filter")} /></Show>
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
