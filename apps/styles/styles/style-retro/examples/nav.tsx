// Retro Nav — chunky bordered bar, pixel font caps, amber palette
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="border-b-4 border-black bg-amber-400">
      <div className="flex items-center justify-between px-5 py-3 max-w-5xl mx-auto">
        <span className="font-mono font-black text-base uppercase tracking-widest text-black">
          ★ RETRO.IO
        </span>
        <div className="flex items-center gap-0">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                font-mono font-bold text-xs uppercase tracking-widest px-4 py-2
                border-l-2 border-black first:border-l-0
                ${link.active ? "bg-black text-amber-400" : "text-black hover:bg-black hover:text-amber-400 transition-colors"}
              `}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
