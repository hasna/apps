import { useMemo, useState } from "react";
import clsx from "clsx";
import { Board, DrawSurface, NoteEditor } from "@hasna/draw/react";
import {
  addCard,
  boardStats,
  clearScene,
  createScene,
  drawing,
  note,
  serializeBoard,
  toExcalidraw,
} from "@hasna/draw";
import type { Board as BoardData, CardColor, CardPatch, DrawScene } from "@hasna/draw";
import { seedBoard } from "../lib/seed.js";

const DRAFT_SIZE = { width: 320, height: 240 } as const;
const PALETTE: CardColor[] = ["default", "yellow", "green", "blue", "orange", "pink", "purple"];
const STROKE_COLORS = ["#e6e7ea", "#f59e0b", "#22c55e", "#3b82f6", "#ec4899"];

type Tab = "json" | "excalidraw";

export function BoardDemo() {
  const [board, setBoard] = useState<BoardData>(seedBoard);
  const [draftNote, setDraftNote] = useState<CardPatch>({});
  const [draftColor, setDraftColor] = useState<CardColor>("default");
  const [scene, setScene] = useState<DrawScene>(() => createScene(DRAFT_SIZE));
  const [strokeColor, setStrokeColor] = useState<string>(STROKE_COLORS[0]!);
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<Tab>("json");

  const stats = useMemo(() => boardStats(board), [board]);
  const preview = useMemo(() => {
    if (tab === "json") return serializeBoard(board, true);
    const firstDrawing = board.cards.find((c) => c.kind === "drawing" && c.scene);
    if (!firstDrawing?.scene) return "Add a drawing card to see its Excalidraw export.";
    return JSON.stringify(toExcalidraw(firstDrawing.scene), null, 2);
  }, [board, tab]);

  const addNote = () => {
    if (!draftNote.title && !draftNote.text) return;
    setBoard((b) => addCard(b, note({ title: draftNote.title, text: draftNote.text, color: draftColor })));
    setDraftNote({});
    setDraftColor("default");
  };

  const addSketch = () => {
    if (scene.elements.length === 0) return;
    setBoard((b) => addCard(b, drawing({ scene, color: draftColor })));
    setScene(createScene(DRAFT_SIZE));
    setDraftColor("default");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Board</h2>
          <label className="flex items-center gap-2 text-xs text-[#8b90a0]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        <Board
          board={board}
          onChange={setBoard}
          query={showArchived ? { archived: true } : undefined}
          editable
        />
      </div>

      <div className="space-y-6">
        <section className="space-y-3 rounded-xl border border-[#23252b] bg-[#111318] p-4">
          <h2 className="text-sm font-semibold text-white">New note</h2>
          <NoteEditor
            card={draftNote}
            onChange={(patch) => setDraftNote((d) => ({ ...d, ...patch }))}
          />
          <ColorRow value={draftColor} onChange={setDraftColor} />
          <button type="button" className="demo-button" onClick={addNote}>
            Add note
          </button>
        </section>

        <section className="space-y-3 rounded-xl border border-[#23252b] bg-[#111318] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">New sketch</h2>
            <div className="flex gap-1">
              {STROKE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={clsx("stroke-swatch", strokeColor === c && "stroke-swatch--active")}
                  style={{ background: c }}
                  aria-label={`stroke ${c}`}
                  onClick={() => setStrokeColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-[#23252b] bg-[#0b0c10] text-[#e6e7ea]">
            <DrawSurface scene={scene} onChange={setScene} color={strokeColor} height={240} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="demo-button" onClick={addSketch}>
              Add sketch
            </button>
            <button
              type="button"
              className="demo-button demo-button--ghost"
              onClick={() => setScene((s) => clearScene(s))}
            >
              Clear
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-[#23252b] bg-[#111318]">
          <div className="flex items-center justify-between border-b border-[#23252b] p-3">
            <div className="flex gap-1">
              {(["json", "excalidraw"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={clsx(
                    "rounded-md px-2.5 py-1 text-xs",
                    tab === t ? "bg-[#f59e0b] text-black" : "text-[#cbd0d8] hover:bg-[#232733]",
                  )}
                >
                  {t === "json" ? "Board JSON" : "Excalidraw"}
                </button>
              ))}
            </div>
            <span className="text-xs text-[#8b90a0]">
              {stats.total} cards · {stats.notes} notes · {stats.drawings} drawings · {stats.pinned}{" "}
              pinned
            </span>
          </div>
          <pre className="m-0 max-h-[360px] overflow-auto p-3 text-[12px] leading-relaxed text-[#cbd0d8] whitespace-pre-wrap break-words">
            {preview}
          </pre>
        </section>
      </div>
    </div>
  );
}

function ColorRow({ value, onChange }: { value: CardColor; onChange: (color: CardColor) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          className={clsx("card-swatch", value === color && "card-swatch--active")}
          data-color={color}
          aria-label={color}
          title={color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
