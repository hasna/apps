// Glassmorphism Hero — vibrant gradient bg, glass card overlay
export function Hero() {
  return (
    <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden bg-gradient-to-br from-violet-600 via-indigo-700 to-cyan-600 px-4">
      {/* Background blur orbs */}
      <div className="absolute top-10 left-20 w-64 h-64 bg-pink-400 rounded-full opacity-30 blur-3xl" />
      <div className="absolute bottom-10 right-20 w-64 h-64 bg-cyan-400 rounded-full opacity-30 blur-3xl" />

      {/* Glass card */}
      <div className="relative z-10 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl px-10 py-12 max-w-xl text-center">
        <span className="inline-block text-xs font-semibold text-white/70 uppercase tracking-widest mb-4">
          Welcome
        </span>
        <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
          See through the noise
        </h1>
        <p className="text-white/70 text-sm leading-relaxed mb-8">
          A UI that layers depth, translucency, and light. Built on blur and beauty.
        </p>
        <button className="px-6 py-2.5 text-sm font-semibold text-white bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl hover:bg-white/30 transition-all shadow-md">
          Explore
        </button>
      </div>
    </section>
  );
}
