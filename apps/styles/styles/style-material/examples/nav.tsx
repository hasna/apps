// Material Top App Bar — elevation-2 shadow, surface color, navigation icon
export function Nav({ title, links }: { title: string; links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <header className="bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="flex items-center h-14 px-4 max-w-5xl mx-auto">
        <span className="text-base font-medium text-gray-900 flex-1">{title}</span>
        <nav className="flex items-center">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md uppercase tracking-wide transition-colors
                ${link.active
                  ? "text-blue-600 bg-blue-50"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"}
              `}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
