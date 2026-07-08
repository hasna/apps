import { useState } from "react";
import clsx from "clsx";

type Tab = "markdown" | "html" | "json";

export interface PreviewProps {
  markdown: string;
  html: string;
  json: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "markdown", label: "Markdown" },
  { id: "html", label: "HTML" },
  { id: "json", label: "JSON" },
];

export function Preview({ markdown, html, json }: PreviewProps) {
  const [tab, setTab] = useState<Tab>("markdown");
  const value = tab === "markdown" ? markdown : tab === "html" ? html : json;

  return (
    <div className="rounded-xl border border-[#23252b] bg-[#111318] overflow-hidden">
      <div className="flex gap-1 border-b border-[#23252b] bg-[#15171d] p-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "rounded-lg px-3 py-1 text-sm",
              tab === t.id ? "bg-[#3b82f6] text-white" : "text-[#cbd0d8] hover:bg-[#232733]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className="m-0 max-h-[420px] overflow-auto p-4 text-[13px] leading-relaxed text-[#cbd0d8] whitespace-pre-wrap break-words">
        {value}
      </pre>
    </div>
  );
}
