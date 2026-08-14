// Retro Card — chunky border, retro offset shadow, pixel-ish heading
export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-2 border-black bg-amber-50 p-5 shadow-[3px_3px_0_0_#000]">
      <h3 className="font-mono font-bold text-sm uppercase tracking-wider text-amber-900 mb-2">
        ★ {title}
      </h3>
      <hr className="border-amber-300 mb-3" />
      <p className="font-mono text-xs text-amber-800 leading-relaxed">{description}</p>
    </div>
  );
}
