import type { OutlineEntry, DocumentStats } from "@hasna/docs";

export interface OutlineProps {
  entries: OutlineEntry[];
  stats: DocumentStats;
}

export function Outline({ entries, stats }: OutlineProps) {
  return (
    <div className="rounded-xl border border-[#23252b] bg-[#111318] p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#8b90a0]">
        Outline
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-[#6b7080]">No headings yet.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              style={{ paddingLeft: `${(entry.level - 1) * 14}px` }}
              className="text-sm text-[#cbd0d8]"
            >
              <span className="mr-2 text-[11px] text-[#60a5fa]">h{entry.level}</span>
              {entry.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#23252b] pt-4 text-sm">
        <Stat label="Words" value={stats.words} />
        <Stat label="Characters" value={stats.characters} />
        <Stat label="Paragraphs" value={stats.paragraphs} />
        <Stat label="Reading time" value={`${stats.readingTimeMinutes} min`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[#6b7080]">{label}</div>
      <div className="text-[#e6e7ea]">{value}</div>
    </div>
  );
}
