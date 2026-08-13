/**
 * A Keep style board: a responsive card grid that floats pinned cards into their
 * own section above the rest. It is a controlled component; edits are applied to
 * the board with the pure functional core ops and surfaced through `onChange`.
 *
 * Ships no CSS of its own, only semantic class names (`hasna-draw-board`,
 * `hasna-draw-board__section`, `hasna-draw-board__grid`, ...).
 */
import { Fragment, useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type {
  Board as BoardData,
  Card as CardData,
  CardPatch,
  CardQuery,
  CardSort,
} from "../types/index.js";
import { listCards } from "../query/query.js";
import { archiveCard, pinCard, updateCard } from "../ops/cards.js";
import { cn } from "./svg.js";
import { Card } from "./Card.js";

export interface BoardProps {
  /** The board to render (source of truth). */
  board: BoardData;
  /** Called with a new board after an edit. Omit for a read only board. */
  onChange?: (board: BoardData) => void;
  /** Filter applied before rendering. */
  query?: CardQuery;
  /** Sort order within each section. Defaults to "order". */
  sort?: CardSort;
  /** Fixed column count. When omitted the grid auto fills responsively. */
  columns?: number;
  /** Enable per card controls (pin/archive/color). Defaults to true. */
  editable?: boolean;
  /** Called with a card id when a card body is clicked. */
  onOpenCard?: (id: string) => void;
  /** Custom card renderer. Receives each already filtered/sorted card. */
  renderCard?: (card: CardData) => ReactNode;
  className?: string;
}

export function Board(props: BoardProps): ReactElement {
  const {
    board,
    onChange,
    query,
    sort = "order",
    columns,
    editable = true,
    onOpenCard,
    renderCard,
    className,
  } = props;

  const cards = useMemo(() => listCards(board, query, sort), [board, query, sort]);
  const pinned = cards.filter((c) => c.pinned);
  const others = cards.filter((c) => !c.pinned);

  const canEdit = editable && Boolean(onChange);
  const gridStyle: CSSProperties | undefined = columns
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : undefined;

  const renderOne = (card: CardData): ReactNode => {
    if (renderCard) return <Fragment key={card.id}>{renderCard(card)}</Fragment>;
    return (
      <Card
        key={card.id}
        card={card}
        readOnly={!canEdit}
        onChange={canEdit ? (patch: CardPatch) => onChange?.(updateCard(board, card.id, patch)) : undefined}
        onPin={canEdit ? () => onChange?.(pinCard(board, card.id)) : undefined}
        onArchive={canEdit ? () => onChange?.(archiveCard(board, card.id)) : undefined}
        onOpen={onOpenCard ? () => onOpenCard(card.id) : undefined}
      />
    );
  };

  return (
    <div className={cn("hasna-draw-board", className)}>
      {pinned.length > 0 ? (
        <section className="hasna-draw-board__section" data-section="pinned">
          <h2 className="hasna-draw-board__heading">Pinned</h2>
          <div className="hasna-draw-board__grid" style={gridStyle}>
            {pinned.map(renderOne)}
          </div>
        </section>
      ) : null}

      <section className="hasna-draw-board__section" data-section="others">
        {pinned.length > 0 && others.length > 0 ? (
          <h2 className="hasna-draw-board__heading">Others</h2>
        ) : null}
        <div className="hasna-draw-board__grid" style={gridStyle}>
          {others.map(renderOne)}
        </div>
      </section>
    </div>
  );
}
