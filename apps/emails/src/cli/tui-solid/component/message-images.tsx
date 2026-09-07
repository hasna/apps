import { safeMailText } from "../../tui/message-document.js";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { NativeImage } from "@opentui/core";
import {
  mailImages,
  loadMailImage,
  type MailImageAttachment,
  type MailImageSource,
} from "../../tui/mail-images.js";
import { resolveMailDataSource } from "../../../lib/mail-data-source.js";
import { useTheme } from "../context/theme.js";
import { Disclosure, ReaderAction } from "./message-content.js";

export function MailImagePreview(props: {
  source: MailImageSource;
  messageId?: string;
  load?: typeof loadMailImage;
}) {
  const theme = useTheme();
  const [image, setImage] = createSignal<NativeImage>();
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  let active = true;
  let decoded: NativeImage | undefined;
  const controller = new AbortController();
  onCleanup(() => {
    active = false;
    controller.abort();
    decoded?.dispose();
  });
  const load = async () => {
    if (loading() || image()) return;
    setLoading(true);
    setError("");
    try {
      const data = await (props.load ?? loadMailImage)(props.source, {
        messageId: props.messageId,
        allowRemote: props.source.kind === "remote",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
        getAttachment: (id, index, opts) =>
          resolveMailDataSource().getAttachmentContent(id, index, opts),
      });
      if (!active) return;
      decoded = NativeImage.decode(data);
      setImage(decoded);
    } catch (e) {
      if (active)
        setError(
          safeMailText(
            e instanceof Error ? e.message : "Image preview unavailable",
          ).slice(0, 500),
        );
    } finally {
      if (active) setLoading(false);
    }
  };
  onMount(() => {
    if (props.source.kind !== "remote") void load();
  });
  return (
    <box width="100%" flexDirection="column" flexShrink={0}>
      <Show when={props.source.kind === "remote" && !image()}>
        <text fg={theme.textMuted} wrapMode="word">
          External image blocked. Loading contacts the sender's image host.
        </text>
        <Show when={!loading()}>
          <ReaderAction
            label="Load external image"
            onPress={() => void load()}
          />
        </Show>
      </Show>
      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading image…</text>
      </Show>
      <Show when={error()}>
        <text fg={theme.warning} wrapMode="word">
          {error()}
        </text>
      </Show>
      <Show when={image()}>
        {(value) => (
          <image
            source={value()}
            width="100%"
            height={Math.max(
              2,
              Math.min(
                18,
                Math.ceil((60 * value().height) / value().width / 2),
              ),
            )}
            fit="fit"
            protocol="auto"
            onError={() =>
              setError(
                "This terminal could not render the image. Use the attachment action or image link.",
              )
            }
          />
        )}
      </Show>
      <Show when={props.source.kind === "remote"}>
        <text fg={theme.markdownLink}>
          <a
            href={
              (props.source as Extract<MailImageSource, { kind: "remote" }>).url
            }
          >
            Open image link
          </a>
        </text>
      </Show>
    </box>
  );
}

export function MessageImages(props: {
  text?: string | null;
  html?: string | null;
  messageId?: string;
  attachments?: MailImageAttachment[];
  loadImage?: typeof loadMailImage;
}) {
  const images = createMemo(() =>
    mailImages(props.text, props.html, props.attachments),
  );
  return (
    <Show when={images().length > 0}>
      <box width="100%" flexDirection="column" flexShrink={0} marginTop={1}>
        <For each={images()}>
          {(source) => (
            <Disclosure
              label={`Image: ${source.label}`}
              detail={
                source.kind === "remote"
                  ? "external"
                  : source.kind === "unavailable"
                    ? "unavailable"
                    : "preview"
              }
            >
              <MailImagePreview
                source={source}
                messageId={props.messageId}
                load={props.loadImage}
              />
            </Disclosure>
          )}
        </For>
      </box>
    </Show>
  );
}
