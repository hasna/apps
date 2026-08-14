// Editorial Hero — large serif display, asymmetric layout, pull quote
export function Hero() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-12 px-8 py-16 max-w-5xl mx-auto">
      <div className="flex flex-col justify-between">
        <div>
          <p className="font-sans text-xs uppercase tracking-widest text-neutral-400 mb-6">
            Issue No. 47 · Spring Edition
          </p>
          <h1 className="font-serif text-5xl font-bold text-neutral-900 leading-tight mb-6">
            The Art of<br />Considered<br />Design
          </h1>
          <a
            href="#read"
            className="font-sans text-xs uppercase tracking-widest text-neutral-900 border-b border-neutral-900 pb-0.5 hover:text-neutral-400 hover:border-neutral-400 transition-colors"
          >
            Begin reading
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <blockquote className="border-l-2 border-neutral-900 pl-5">
          <p className="font-serif text-xl italic text-neutral-700 leading-loose">
            "Good design, when it is done well, becomes invisible. It's only bad design
            that makes itself known."
          </p>
          <cite className="mt-3 block font-sans text-xs uppercase tracking-widest text-neutral-400">
            — Jared Spool
          </cite>
        </blockquote>
        <p className="font-serif text-sm text-neutral-600 leading-loose">
          In this issue we explore the tension between restraint and expression — how
          the best designers know exactly when to add and when to subtract.
        </p>
      </div>
    </section>
  );
}
