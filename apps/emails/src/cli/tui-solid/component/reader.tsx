import { For, Show } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEmails } from "../context/emails-state.js";
import { useTheme } from "../context/theme.js";
import { Button, EmptyState } from "../ui/primitives.js";
import { formatDate } from "../../tui/format.js";
import { safeMailText } from "../../tui/message-document.js";
import { Disclosure, MessageContent, ReaderControlsProvider } from "./message-content.js";

export function ReaderRoute() {
  const theme = useTheme();
  const emails = useEmails();
  let scroll: ScrollBoxRenderable | undefined;
  return (
    <ReaderControlsProvider scroll={() => scroll} enabled={!emails.state.dialog && !emails.state.compose}>
      <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background} paddingTop={1} paddingLeft={2} paddingRight={2}>
        <Show when={!emails.selectedBody.loading && emails.selectedBody()} fallback={
          <EmptyState fill icon={emails.state.readerError ? "!" : "✉"}
            title={emails.selectedBody.loading ? "Opening message" : emails.state.readerError ? "Couldn't open this message" : "Message not found"}
            detail={emails.selectedBody.loading ? "Loading the conversation…" : emails.state.readerError ? "Check your connection and try again." : "It may have moved or been deleted."}>
            <box flexDirection="row" columnGap={1}>
              <Show when={!emails.selectedBody.loading && emails.state.readerError}><Button label="Try again" onPress={emails.actions.retryBody} /></Show>
              <Button label="Back to inbox" onPress={emails.actions.backToList} />
            </box>
          </EmptyState>
        }>
          {(body) => (
            <>
              <box flexDirection="row" width="100%" flexShrink={0} marginBottom={1} columnGap={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD} flexGrow={1} flexShrink={1} wrapMode="word">{safeMailText(body().subject)}</text>
                <Button label="Back" onPress={() => emails.actions.backToList()} />
              </box>
              <scrollbox ref={(value) => { scroll = value; }} flexGrow={1} minHeight={0} width="100%" scrollX={false} verticalScrollbarOptions={{ trackOptions: { backgroundColor: theme.backgroundElement, foregroundColor: theme.borderActive } }}
                contentOptions={{ flexDirection: "column", flexShrink: 0 }}>
                <Show when={emails.conversation().length > 1} fallback={
                  <>
                    <box width="100%" flexDirection="column" flexShrink={0} marginBottom={1}>
                      <text fg={theme.text} wrapMode="word">From: {safeMailText(body().from)}</text>
                      <text fg={theme.textMuted} wrapMode="word">To: {safeMailText(body().to)}</text>
                      <text fg={theme.textMuted}>Date: {formatDate(body().date)}</text>
                      <Show when={body().is_priority}><text fg={theme.warning}>★ Priority sender</text></Show>
                    </box>
                    <MessageContent text={body().text} html={body().html} />
                  </>
                }>
                  <For each={emails.conversation()}>
                    {(entry) => (
                      <Disclosure label={entry.body?.from ?? entry.item.from} detail={formatDate(entry.body?.date ?? entry.item.at)}
                        initiallyOpen={entry.item.id === emails.selectedMessage()?.id && entry.item.storage === (emails.selectedMessage()?.kind === "sent" ? "email" : "inbound")}>
                        <box flexDirection="column" flexShrink={0} marginBottom={1}>
                          <text fg={theme.textMuted} wrapMode="word">From: {safeMailText(entry.body?.from ?? entry.item.from)}</text>
                          <text fg={theme.textMuted} wrapMode="word">To: {safeMailText(entry.body?.to ?? "")}</text>
                        </box>
                        <MessageContent text={entry.body?.text} html={entry.body?.html} />
                      </Disclosure>
                    )}
                  </For>
                </Show>
                <Show when={body().attachments.length > 0}>
                  <box flexShrink={0} marginTop={1} marginBottom={1}>
                    <Button label={`${body().attachments.length} attachment${body().attachments.length === 1 ? "" : "s"} available`} onPress={() => emails.actions.openDialog("attachments")} />
                  </box>
                </Show>
                <Show when={body().summary}>
                  <Disclosure label="Summary"><MessageContent text={body().summary} /></Disclosure>
                </Show>
              </scrollbox>
              <box flexDirection="row" flexWrap="wrap" flexShrink={0} width="100%" columnGap={1} rowGap={1} marginTop={1}>
                <Button label="Reply" onPress={() => emails.selectedMessage() && emails.actions.startCompose("reply", emails.selectedMessage()!)} />
                <Button label="Forward" onPress={() => emails.selectedMessage() && emails.actions.startCompose("forward", emails.selectedMessage()!)} />
                <Show when={body().attachments.length > 0}><Button label="Attachments" onPress={() => emails.actions.openDialog("attachments")} /></Show>
                <Show when={emails.links().length > 0}><Button label="Links" onPress={() => emails.actions.openDialog("links")} /></Show>
                <Button label="Raw" onPress={() => emails.actions.openDialog("raw")} />
                <Button label="Label" onPress={() => emails.actions.openDialog("labels")} />
              </box>
              <text fg={theme.textMuted} flexShrink={0} wrapMode="word" marginTop={1}>↑↓ Scroll · Tab Sections · Enter Expand</text>
            </>
          )}
        </Show>
      </box>
    </ReaderControlsProvider>
  );
}
