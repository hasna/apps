/**
 * A minimal controlled note editor: a title input and a body textarea. It emits
 * {@link CardPatch} updates (`{ title }` or `{ text }`) so a parent can feed them
 * straight into `updateCard` / `addCard` from the headless core.
 */
import type { ChangeEvent, ReactElement } from "react";
import type { CardPatch } from "../types/index.js";
import { cn } from "./svg.js";

export interface NoteEditorProps {
  /** Current note fields (only title/text are read). */
  card?: { title?: string; text?: string };
  /** Called with the changed field on every keystroke. */
  onChange?: (patch: CardPatch) => void;
  titlePlaceholder?: string;
  textPlaceholder?: string;
  /** Textarea rows. Defaults to 4. */
  rows?: number;
  className?: string;
}

export function NoteEditor(props: NoteEditorProps): ReactElement {
  const {
    card,
    onChange,
    titlePlaceholder = "Title",
    textPlaceholder = "Take a note...",
    rows = 4,
    className,
  } = props;

  const onTitle = (e: ChangeEvent<HTMLInputElement>) => onChange?.({ title: e.target.value });
  const onText = (e: ChangeEvent<HTMLTextAreaElement>) => onChange?.({ text: e.target.value });

  return (
    <div className={cn("hasna-draw-note-editor", className)}>
      <input
        className="hasna-draw-note-editor__title"
        type="text"
        value={card?.title ?? ""}
        placeholder={titlePlaceholder}
        onChange={onTitle}
      />
      <textarea
        className="hasna-draw-note-editor__text"
        value={card?.text ?? ""}
        placeholder={textPlaceholder}
        rows={rows}
        onChange={onText}
      />
    </div>
  );
}
