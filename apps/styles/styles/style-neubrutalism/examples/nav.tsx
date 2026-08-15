// Neubrutalism Nav — border-b-4 border-black, bold fills, offset nav items
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="border-b-4 border-black bg-yellow-300">
      <div className="flex items-center justify-between px-5 max-w-5xl mx-auto">
        <span className="font-black text-lg text-black py-4 tracking-tight">
          NEU/BRUTAL
        </span>
        <div className="flex items-center">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                font-bold text-sm text-black px-4 py-4 border-l-2 border-black first:border-l-0
                transition-colors
                ${link.active ? "bg-black text-yellow-300" : "hover:bg-black hover:text-yellow-300"}
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
