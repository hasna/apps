// Retro Hero — pixel art feel, scanline effect, terminal text style
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-amber-50 border-b-4 border-black px-6 py-16">
      {/* Scanline overlay effect */}
      <div
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, #000 2px, #000 4px)",
        }}
      />

      <div className="relative max-w-2xl">
        <div className="mb-6 inline-block border-2 border-black px-3 py-1 bg-amber-400 shadow-[2px_2px_0_0_#000]">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-black">
            ★★ LOADING COMPLETE ★★
          </span>
        </div>

        <h1 className="font-mono font-black text-5xl uppercase leading-none text-black mb-6">
          WELCOME<br />TO THE<br />PAST
        </h1>

        <div className="border-2 border-black bg-black p-4 mb-8 shadow-[3px_3px_0_0_#92400e]">
          <p className="font-mono text-xs text-amber-400 leading-relaxed">
            &gt; System initialized...<br />
            &gt; Design loaded: RETRO v1.984<br />
            &gt; Nostalgia module active_
          </p>
        </div>

        <button className="font-mono font-bold text-sm uppercase tracking-widest px-6 py-3 bg-amber-400 border-2 border-black shadow-[4px_4px_0_0_#000] hover:shadow-[2px_2px_0_0_#000] hover:translate-x-[2px] hover:translate-y-[2px] transition-all">
          [ PRESS START ]
        </button>
      </div>
    </section>
  );
}
