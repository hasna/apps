import { useEffect, useMemo, useState } from "react";
import { createDeck, exportDeckHtml, parseMarkdownDeck, serializeDeck } from "@hasna/slides";
import type { DeckData, Slide } from "@hasna/slides";
import { Presentation } from "@hasna/slides/react";
import { Download, FileCode, FileJson, Presentation as PresentationIcon } from "lucide-react";
import { SAMPLE_MARKDOWN } from "@/lib/sample";
import { downloadText, slugify } from "@/lib/download";

const THEMES = [
  "black",
  "white",
  "league",
  "beige",
  "night",
  "serif",
  "simple",
  "solarized",
  "moon",
  "dracula",
  "sky",
];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function flatten(slides: Slide[]): { slide: Slide; label: string }[] {
  const out: { slide: Slide; label: string }[] = [];
  slides.forEach((slide, i) => {
    out.push({ slide, label: `${i + 1}` });
    (slide.children ?? []).forEach((child, j) => {
      out.push({ slide: child, label: `${i + 1}.${j + 1}` });
    });
  });
  return out;
}

function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.replace(/^#+\s*/, "").replace(/[*_`>#-]/g, "").trim() || "Untitled slide";
}

export function App() {
  const [title, setTitle] = useState("@hasna/slides deck");
  const [theme, setTheme] = useState("black");
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const debouncedMarkdown = useDebounced(markdown, 300);

  const deck: DeckData = useMemo(() => {
    const slides = parseMarkdownDeck(debouncedMarkdown);
    return createDeck({ title, theme, slides }).data;
  }, [debouncedMarkdown, title, theme]);

  const outline = flatten(deck.slides);

  const exportHtml = () => {
    const html = exportDeckHtml(deck, { theme });
    downloadText(`${slugify(title)}.html`, html, "text/html");
  };

  const exportJson = () => {
    downloadText(`${slugify(title)}.json`, serializeDeck(deck), "application/json");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-5 py-3">
        <div className="flex items-center gap-2 text-amber-400">
          <PresentationIcon size={20} />
          <span className="font-semibold tracking-tight text-slate-100">slides studio</span>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-48 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500"
          placeholder="Deck title"
        />
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500"
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={exportHtml}
          className="flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-400"
        >
          <FileCode size={16} /> Export HTML
        </button>
        <button
          onClick={exportJson}
          className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500"
        >
          <FileJson size={16} /> JSON
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="flex min-h-0 flex-col border-r border-slate-800">
          <div className="flex items-center justify-between px-4 py-2 text-xs uppercase tracking-wider text-slate-400">
            <span>Markdown</span>
            <span>
              {deck.slides.length} slides · {outline.length} views
            </span>
          </div>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none border-0 bg-slate-950 px-4 py-3 font-mono text-sm leading-relaxed text-slate-200 outline-none"
          />
          <div className="max-h-56 overflow-auto border-t border-slate-800 bg-slate-900/40 px-4 py-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">
              Speaker notes
            </div>
            <ul className="space-y-2 text-sm">
              {outline.map(({ slide, label }) => (
                <li key={slide.id} className="flex gap-2">
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 text-xs text-amber-300">
                    {label}
                  </span>
                  <span className="text-slate-300">
                    <span className="text-slate-400">{firstLine(slide.body)}</span>
                    {slide.notes ? (
                      <span className="mt-0.5 block text-slate-500">{slide.notes}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-slate-900/30">
          <div className="flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-wider text-slate-400">
            <Download size={12} /> Live preview · arrows to navigate · O for overview · S for notes
          </div>
          <div className="preview-surface min-h-0 flex-1 p-4">
            <div className="h-full overflow-hidden rounded-lg border border-slate-800 bg-black">
              <Presentation deck={deck} theme={theme} embedded />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
