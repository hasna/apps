import { useMemo, useState } from "react";
import { Editor } from "@hasna/docs/react";
import { countWords, Document, getOutline, toHTML, toMarkdown } from "@hasna/docs";
import type { DocJSON } from "@hasna/docs";
import { Preview } from "./components/Preview.js";
import { Outline } from "./components/Outline.js";
import { SAMPLE_MARKDOWN } from "./lib/sample.js";

export function App() {
  const [doc, setDoc] = useState<DocJSON>(() =>
    Document.fromMarkdown(SAMPLE_MARKDOWN).toJSON(),
  );

  const derived = useMemo(
    () => ({
      markdown: toMarkdown(doc),
      html: toHTML(doc),
      json: JSON.stringify(doc, null, 2),
      outline: getOutline(doc),
      stats: countWords(doc),
    }),
    [doc],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">@hasna/docs</h1>
        <p className="mt-1 text-sm text-[#8b90a0]">
          Headless rich-text document SDK with a TipTap-based editor. Type on the left; the
          SDK parses, serializes, and analyzes on the right — all from the same JSON.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Editor value={doc} onChange={setDoc} />
        </div>
        <div className="space-y-6">
          <Preview markdown={derived.markdown} html={derived.html} json={derived.json} />
          <Outline entries={derived.outline} stats={derived.stats} />
        </div>
      </div>
    </div>
  );
}
