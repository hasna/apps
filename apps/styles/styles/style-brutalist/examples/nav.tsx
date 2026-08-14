// Brutalist Nav — thick bottom border, bold caps, monospace
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b-4 border-black bg-white">
      <span className="font-mono font-black text-lg uppercase tracking-widest text-black">
        SITE
      </span>
      <div className="flex items-center gap-0">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={`
              font-mono font-bold text-xs uppercase tracking-widest px-4 py-2
              border-4 border-transparent
              ${link.active ? "border-black bg-black text-white" : "text-black hover:bg-black hover:text-white transition-colors"}
            `}
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
