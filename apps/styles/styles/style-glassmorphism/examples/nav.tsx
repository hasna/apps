// Glassmorphism Nav — fixed top, backdrop-blur, translucent dark bg
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-black/20 backdrop-blur-md border-b border-white/10">
      <div className="mx-auto max-w-5xl px-6 flex h-14 items-center justify-between">
        <span className="text-sm font-bold text-white tracking-tight">Glass</span>
        <div className="flex items-center gap-1">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                px-3 py-1.5 text-sm rounded-lg transition-all
                ${link.active
                  ? "bg-white/20 text-white font-medium"
                  : "text-white/70 hover:text-white hover:bg-white/10"}
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
