// Brutalist Card — thick black border, solid offset shadow, monospace font
export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-4 border-black p-6 shadow-[4px_4px_0_0_#000] bg-white">
      <h3 className="font-mono font-bold text-base uppercase tracking-wider text-black mb-3">
        {title}
      </h3>
      <p className="font-mono text-sm text-black leading-relaxed">{description}</p>
    </div>
  );
}
