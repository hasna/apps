// Material 3 Hero — color container background, display text, filled button + FAB
export function Hero() {
  return (
    <section className="bg-blue-50 px-6 py-20">
      <div className="max-w-2xl mx-auto">
        <p className="text-xs font-medium uppercase tracking-widest text-blue-600 mb-4">
          Material Design 3
        </p>
        <h1 className="text-5xl font-light text-blue-950 leading-tight mb-5 tracking-tight">
          Design that<br />adapts to you
        </h1>
        <p className="text-base text-blue-800/70 leading-relaxed mb-10 max-w-lg">
          Dynamic color, expressive typography, and accessible components — built on the
          Material Design 3 system.
        </p>
        <div className="flex items-center gap-4">
          <button className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-full uppercase tracking-wide shadow hover:shadow-md hover:bg-blue-700 transition-all">
            Get started
          </button>
          {/* FAB */}
          <button
            aria-label="Add"
            className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-700 shadow-md flex items-center justify-center text-2xl hover:bg-blue-200 hover:shadow-lg transition-all"
          >
            +
          </button>
        </div>
      </div>
    </section>
  );
}
