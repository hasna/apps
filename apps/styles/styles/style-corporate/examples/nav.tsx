// Corporate Nav — structured topbar with logo, links, and CTA button
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="text-sm font-bold text-blue-700 tracking-tight">
              Acme Corp
            </span>
            <div className="hidden md:flex items-center gap-1">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={`
                    px-3 py-1.5 text-sm rounded-md transition-colors
                    ${link.active
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}
                  `}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <button className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
            Sign In
          </button>
        </div>
      </div>
    </nav>
  );
}
