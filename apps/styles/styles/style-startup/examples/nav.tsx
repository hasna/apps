// Startup Nav — glassmorphism nav bar, gradient logo text
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-4xl">
      <div className="flex items-center justify-between px-5 py-2.5 rounded-2xl bg-white/80 backdrop-blur-md border border-white/60 shadow-lg shadow-black/5">
        <span className="text-sm font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Launchpad
        </span>
        <div className="flex items-center gap-1">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                px-3 py-1.5 text-sm rounded-lg transition-colors
                ${link.active
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}
              `}
            >
              {link.label}
            </a>
          ))}
        </div>
        <button className="px-4 py-1.5 text-sm font-semibold text-white rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 transition-all shadow-sm">
          Get started
        </button>
      </div>
    </nav>
  );
}
