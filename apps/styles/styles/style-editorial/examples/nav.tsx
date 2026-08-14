// Editorial Nav — centered, spaced-out caps, horizontal rule below
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <header>
      <nav className="flex flex-col items-center py-5 px-6">
        <span className="font-serif font-bold text-2xl text-neutral-900 tracking-tight mb-4">
          The Review
        </span>
        <div className="flex items-center gap-6">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                font-sans text-xs uppercase tracking-widest transition-colors
                ${link.active
                  ? "text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-700"}
              `}
            >
              {link.label}
            </a>
          ))}
        </div>
      </nav>
      <hr className="border-t border-neutral-900" />
      <hr className="border-t border-neutral-200 mt-0.5" />
    </header>
  );
}
