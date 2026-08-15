// Neubrutalism Hero — oversized bold heading, neubrutalist card, rotated accent element
export function Hero() {
  return (
    <section className="bg-white px-6 py-16 overflow-hidden">
      <div className="max-w-4xl mx-auto">
        <div className="relative">
          {/* Rotated accent */}
          <div className="absolute -top-4 -right-4 w-32 h-32 bg-pink-300 border-2 border-black rotate-12 -z-10" />

          <p className="text-sm font-bold uppercase tracking-widest text-black mb-4 border-l-4 border-black pl-3">
            New Wave Design
          </p>
          <h1 className="font-black text-7xl text-black leading-none mb-6 tracking-tight">
            BOLD.<br />LOUD.<br />ALIVE.
          </h1>
        </div>

        <div className="mt-6 border-2 border-black bg-yellow-300 p-5 shadow-[5px_5px_0_0_#000] max-w-md">
          <p className="font-semibold text-sm text-black leading-relaxed">
            Design that doesn't whisper. It shouts, it bounces, it takes up space — and
            it's proud of it.
          </p>
        </div>

        <div className="mt-8 flex items-center gap-4">
          <button className="px-6 py-3 text-sm font-bold text-black bg-yellow-300 border-2 border-black shadow-[4px_4px_0_0_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#000] transition-all">
            Get started
          </button>
          <button className="px-6 py-3 text-sm font-bold text-black bg-white border-2 border-black shadow-[4px_4px_0_0_#000] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#000] transition-all">
            See examples
          </button>
        </div>
      </div>
    </section>
  );
}
