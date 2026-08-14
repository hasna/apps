// Minimalist Hero — large type, generous whitespace, single CTA
export function Hero() {
  return (
    <section className="flex flex-col items-start px-6 py-24 max-w-2xl mx-auto">
      <p className="text-xs text-neutral-400 tracking-widest uppercase mb-6">
        Design System
      </p>
      <h1 className="text-5xl font-light text-neutral-900 leading-tight tracking-tight mb-6">
        Less, but better.
      </h1>
      <p className="text-base text-neutral-500 leading-relaxed mb-10 max-w-prose">
        A minimal foundation for interfaces that respect the reader. Every element earns
        its place.
      </p>
      <a
        href="#start"
        className="text-sm text-neutral-900 border-b border-neutral-900 pb-0.5 hover:text-neutral-500 hover:border-neutral-500 transition-colors"
      >
        Get started →
      </a>
    </section>
  );
}
