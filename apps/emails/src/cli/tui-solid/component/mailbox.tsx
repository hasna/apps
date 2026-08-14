import { For, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { useEmails } from "../context/emails-state.js";
import { labelColor, selectedForeground, useTheme } from "../context/theme.js";
import { Button, EmptyState, Row } from "../ui/primitives.js";
import { bareAddress, listDateTime, truncate } from "../../tui/format.js";
import { isImportantMessage, labelDisplayName, mailboxGroupModeLabel } from "../../tui/data.js";
import { sidebarWidth } from "./sidebar.js";

interface MailboxColumns {
  from: number;
  to: number;
  subject: number;
  date: number;
}

function MessageRow(props: { message: ReturnType<typeof useEmails>["state"]["messages"][number]; selected: boolean; showTo: boolean; columns: MailboxColumns }) {
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
            {truncate(bareAddress(message().from), props.columns.from)}
          </text>
        </box>
        <Show when={props.showTo}>
          <box width={props.columns.to} flexShrink={0}>
            <text fg={props.selected ? rowFg() : theme.textMuted}>{truncate(bareAddress(message().to), props.columns.to)}</text>
          </box>
        </Show>
        <box width={props.columns.subject} flexShrink={0}>
          <text fg={rowFg()} attributes={unread() ? TextAttributes.BOLD : 0}>
            {truncate(message().subject || "(no subject)", props.columns.subject)}
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
  const showTo = () => !emails.selectedAddress().address && dimensions().width >= 108;
  const contentWidth = () => Math.max(48, dimensions().width - sidebarWidth(dimensions().width) - 6);
  const emptyDetail = () => {
    if (emails.state.search && emails.state.activeLabel) return "No messages match this search and label.";
    if (emails.state.search) return "No messages match this search.";
    if (emails.state.activeLabel) return `No messages match ${labelDisplayName(emails.state.activeLabel)}.`;
    return "Pull mail or choose another inbox.";
  };
  const columns = (): MailboxColumns => {
    const width = contentWidth();
    const date = 10;
    // A live search is a subject-first view: the query was matched against
    // subject, sender and body, so the subject deserves the room the From/To
    // pair would otherwise take. Only the search state does this — the plain
    // mailbox layout (and its truncation) is unchanged.
    const searching = emails.state.search !== "";
    if (!showTo()) {
      const targetFrom = width < 64 ? 20 : width < 82 ? 32 : width < 110 ? 40 : 48;
      const from = Math.max(16, Math.min(targetFrom, width - date - 17));
      return {
        from,
        to: 0,
        subject: Math.max(searching ? 20 : 14, width - from - date - 5),
        date,
      };
    }
    const minSubject = searching ? 22 : 14;
    const availableForAddresses = Math.max(34, width - date - minSubject - 6);
    const targetFrom = width < 76 ? 24 : width < 96 ? 28 : 36;
    const targetTo = width < 76 ? 24 : width < 96 ? 28 : 34;
    const from = Math.max(18, Math.min(targetFrom, Math.floor(availableForAddresses * 0.52)));
    const to = Math.max(16, Math.min(targetTo, availableForAddresses - from));
    return {
      from,
      to,
      subject: Math.max(minSubject, width - from - to - date - 6),
      date,
    };
  };
  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background} paddingTop={1} paddingLeft={2} paddingRight={2}>
      <box height={2} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" columnGap={1}>
          <Button label={emails.state.sort === "newest" ? "Newest first" : "Oldest first"} onPress={() => emails.actions.cycleSort()} />
	          <Button
	            label="Filter"
	            active={!!emails.state.search || !!emails.state.activeLabel || !!emails.state.activeFilterId || emails.state.mailbox !== "inbox" || emails.state.selectedSourceId !== "all"}
	            onPress={() => emails.actions.openDialog("filter")}
	          />
          <Button
            label="Group"
            active={emails.state.groupMode !== "none"}
            onPress={() => emails.actions.openDialog("group")}
          />
	          <Button label="Search" onPress={() => emails.actions.openDialog("search")} />
	          <Button label="Sources" active={emails.state.selectedSourceId !== "all"} onPress={() => emails.actions.openDialog("source")} />
	          <Button label="Digest" onPress={() => emails.actions.openDialog("digest")} />
        </box>
        <text fg={theme.textMuted}>Page {emails.state.page + 1}</text>
      </box>

	      <box height={1} paddingLeft={1}>
	        <Show when={emails.state.selectedSourceId !== "all"}>
	          <text fg={theme.textMuted}>Source: {emails.selectedSource().label}</text>
	        </Show>
	      </box>

      <box height={1} flexDirection="row" columnGap={1} paddingLeft={1}>
        <box width={2} flexShrink={0} />
        <box width={columns().from} flexShrink={0}>
          <text fg={theme.textMuted}>From</text>
        </box>
        <Show when={showTo()}>
          <box width={columns().to} flexShrink={0}>
            <text fg={theme.textMuted}>To</text>
          </box>
        </Show>
        <box width={columns().subject} flexShrink={0}>
          <text fg={theme.textMuted}>Subject</text>
        </box>
        <box width={columns().date} flexShrink={0}>
          <text fg={theme.textMuted}>{"Date".padStart(columns().date)}</text>
        </box>
      </box>

      <Show
        when={emails.state.messages.length > 0}
        fallback={<EmptyState title="No messages" detail={emptyDetail()} />}
      >
        <scrollbox flexGrow={1} width="100%">
          <For each={emails.groupedMessages()}>
            {(group) => (
              <>
                <Show when={emails.state.groupMode !== "none"}>
                  <box height={1} paddingLeft={1}>
                    <text fg={theme.textMuted}>{group.title}</text>
                  </box>
                </Show>
                <For each={group.messages}>
                  {(message) => <MessageRow message={message} selected={emails.state.selectedMessageId === message.id} showTo={showTo()} columns={columns()} />}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>

      <box height={1} />
      <box height={2} flexDirection="row" columnGap={1}>
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
