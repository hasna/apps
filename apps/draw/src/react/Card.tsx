/**
 * A single board card. Renders a note's text (preserving line breaks) or a read
 * only SVG preview of a drawing's {@link DrawScene}, with the card color exposed
 * via `data-color` for the consumer to style. When not `readOnly` it shows pin,
 * archive, and color controls that emit through the callbacks / `onChange`.
 *
 * The component ships no CSS of its own; it renders semantic class names
 * (`hasna-draw-card`, `hasna-draw-card__title`, `hasna-draw-card[data-color]`,
 * ...) that the host application styles.
 */
import type { MouseEvent, ReactElement } from "react";
import type { Card as CardData, CardColor, CardPatch } from "../types/index.js";
import { CARD_COLORS } from "../model/card.js";
import { cn } from "./svg.js";
import { DrawSurface } from "./DrawSurface.js";

export interface CardProps {
  /** The card to render. */
  card: CardData;
  /** Called with a patch when a control changes the card (e.g. its color). */
  onChange?: (patch: CardPatch) => void;
  /** Toggle the pinned flag. */
  onPin?: () => void;
  /** Toggle the archived flag. */
  onArchive?: () => void;
  /** Open / focus the card (fires on the card body, not its controls). */
  onOpen?: () => void;
  /** Render without controls (also the mode used for drawing previews). */
  readOnly?: boolean;
  /** Preview height for drawing cards. Defaults to 160. */
  previewHeight?: number;
}

function stop(handler?: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    handler?.();
  };
}

function ColorControls({
  value,
  onChange,
}: {
  value: CardColor;
  onChange: (color: CardColor) => void;
}): ReactElement {
  return (
    <div className="hasna-draw-card__colors" role="group" aria-label="Card color">
      {CARD_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="hasna-draw-card__swatch"
          data-color={color}
          data-active={color === value || undefined}
          aria-label={color}
          aria-pressed={color === value}
          title={color}
          onClick={stop(() => onChange(color))}
        />
      ))}
    </div>
  );
}

export function Card(props: CardProps): ReactElement {
  const { card, onChange, onPin, onArchive, onOpen, readOnly = false, previewHeight = 160 } = props;
  const showControls = !readOnly && (Boolean(onPin) || Boolean(onArchive) || Boolean(onChange));

  return (
    <article
      className={cn("hasna-draw-card", onOpen && "hasna-draw-card--interactive")}
      data-kind={card.kind}
      data-color={card.color}
      data-pinned={card.pinned || undefined}
      data-archived={card.archived || undefined}
      onClick={onOpen}
    >
      {card.title ? <h3 className="hasna-draw-card__title">{card.title}</h3> : null}

      {card.kind === "note" ? (
        <div className="hasna-draw-card__text">{card.text}</div>
      ) : (
        <div className="hasna-draw-card__drawing">
          <DrawSurface scene={card.scene} readOnly height={previewHeight} />
        </div>
      )}

      {card.labels.length > 0 ? (
        <ul className="hasna-draw-card__labels">
          {card.labels.map((label) => (
            <li key={label} className="hasna-draw-card__label">
              {label}
            </li>
          ))}
        </ul>
      ) : null}

      {showControls ? (
        <div className="hasna-draw-card__actions">
          {onPin ? (
            <button
              type="button"
              className="hasna-draw-card__action"
              data-active={card.pinned || undefined}
              aria-pressed={card.pinned}
              title={card.pinned ? "Unpin" : "Pin"}
              onClick={stop(onPin)}
            >
              {card.pinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
          {onArchive ? (
            <button
              type="button"
              className="hasna-draw-card__action"
              title={card.archived ? "Unarchive" : "Archive"}
              onClick={stop(onArchive)}
            >
              {card.archived ? "Unarchive" : "Archive"}
            </button>
          ) : null}
          {onChange ? (
            <ColorControls value={card.color} onChange={(color) => onChange({ color })} />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
