// Startup Hero — gradient heading text, centered, animated badge
export function Hero() {
  return (
    <section className="relative flex flex-col items-center text-center px-4 py-28 overflow-hidden">
      {/* Background blur orbs */}
      <div className="absolute top-0 -left-32 w-96 h-96 bg-purple-200 rounded-full opacity-30 blur-3xl" />
      <div className="absolute bottom-0 -right-32 w-96 h-96 bg-indigo-200 rounded-full opacity-30 blur-3xl" />

      <span className="relative inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 rounded-full border border-indigo-100 mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        Now in public beta
      </span>

      <h1 className="relative text-5xl font-extrabold leading-tight mb-5 max-w-2xl">
        <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Ship faster.
        </span>
        <br />
        <span className="text-gray-900">Look amazing doing it.</span>
      </h1>

      <p className="relative text-base text-gray-500 leading-relaxed mb-8 max-w-lg">
        The design system for modern SaaS. Drop in components, customise in seconds, ship
        with confidence.
      </p>

      <div className="relative flex items-center gap-3">
        <button className="px-6 py-3 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 transition-all">
          Start for free
        </button>
        <button className="px-6 py-3 text-sm font-semibold text-gray-700 rounded-full border border-gray-200 hover:bg-gray-50 transition-colors">
          View demo →
        </button>
      </div>
    </section>
  );
}
