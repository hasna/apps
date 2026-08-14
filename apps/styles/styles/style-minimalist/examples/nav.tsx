// Minimalist Nav — clean horizontal, minimal dividers, no backgrounds
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
      <span className="text-sm font-medium tracking-tight text-neutral-900">Studio</span>
      <div className="flex items-center gap-6">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={
              link.active
                ? "text-sm text-neutral-900"
                : "text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
            }
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
