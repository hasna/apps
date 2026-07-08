import { useEffect } from "react";
import type { ReactElement } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Document } from "../model/document.js";
import type { DocJSON } from "../types/index.js";
import { Toolbar } from "./toolbar.js";

/** Props for the {@link Editor} component. */
export interface EditorProps {
  /** Initial/controlled content as ProseMirror/TipTap JSON. */
  value?: DocJSON;
  /** Initial content as Markdown (used only when `value` is absent). */
  markdown?: string;
  /** Initial content as HTML (used only when `value` and `markdown` are absent). */
  html?: string;
  /** Whether the document is editable. Defaults to `true`. */
  editable?: boolean;
  /** Show the formatting toolbar. Defaults to `true`. */
  showToolbar?: boolean;
  /** Extra class applied to the editor wrapper. */
  className?: string;
  /** Called with the document JSON on every change. */
  onChange?: (doc: DocJSON) => void;
  /** Called with the TipTap editor instance on every change. */
  onUpdate?: (editor: TiptapEditor) => void;
  /** Called once when the editor instance is ready. */
  onReady?: (editor: TiptapEditor) => void;
}

function resolveInitialContent(props: EditorProps): JSONContent {
  if (props.value) return props.value as unknown as JSONContent;
  if (props.markdown != null) {
    return Document.fromMarkdown(props.markdown).toJSON() as unknown as JSONContent;
  }
  if (props.html != null) {
    return Document.fromHTML(props.html).toJSON() as unknown as JSONContent;
  }
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/**
 * A TipTap-based rich-text editor with a formatting toolbar (bold, italic,
 * strike, code, headings, lists, blockquote, code block, links, undo/redo).
 *
 * Emits — and accepts — the same ProseMirror/TipTap JSON produced by the
 * headless `@hasna/docs` SDK, so `onChange` output round-trips through
 * `Document.fromJSON(...)`, `toMarkdown()`, `toHTML()`, etc.
 */
export function Editor(props: EditorProps): ReactElement {
  const {
    editable = true,
    showToolbar = true,
    className,
    onChange,
    onUpdate,
    onReady,
  } = props;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: resolveInitialContent(props),
    editable,
    onUpdate: ({ editor: instance }) => {
      onChange?.(instance.getJSON() as unknown as DocJSON);
      onUpdate?.(instance);
    },
    // Avoid SSR hydration mismatches.
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  // Keep the editor in sync when `value` is controlled externally.
  useEffect(() => {
    if (!editor || !props.value) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(props.value);
    if (current !== next) {
      editor.commands.setContent(props.value as unknown as JSONContent, {
        emitUpdate: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, props.value]);

  return (
    <div className={className ? `hasna-docs-editor ${className}` : "hasna-docs-editor"}>
      {showToolbar ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} className="hasna-docs-editor__content" />
    </div>
  );
}
