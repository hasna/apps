// Brutalist Hero — massive bold type, stark layout, monospace
export function Hero() {
  return (
    <section className="px-6 py-16 bg-white border-b-4 border-black">
      <div className="max-w-4xl">
        <p className="font-mono text-xs uppercase tracking-widest text-black mb-4 border-l-4 border-black pl-3">
          Digital Brutalism
        </p>
        <h1 className="font-mono font-black text-6xl uppercase leading-none tracking-tight text-black mb-8">
          RAW.<br />HONEST.<br />BRUTAL.
        </h1>
        <p className="font-mono text-base text-black max-w-xl leading-relaxed mb-10 border-l-4 border-black pl-3">
          Structure exposed. Decoration removed. Form follows function without apology.
        </p>
        <a
          href="#enter"
          className="
            inline-block font-mono font-bold text-sm uppercase tracking-widest
            px-8 py-4 border-4 border-black bg-black text-white
            shadow-[4px_4px_0_0_#666]
            hover:bg-white hover:text-black transition-colors
          "
        >
          ENTER →
        </a>
      </div>
    </section>
  );
}
