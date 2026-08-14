// Neumorphic Nav — soft extruded nav bar, no harsh borders
export function Nav({ links }: { links: { label: string; href: string; active?: boolean }[] }) {
  return (
    <nav className="bg-gray-100 px-6 py-3 shadow-[0_4px_8px_#bebebe,0_-4px_8px_#ffffff]">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        <span className="text-sm font-semibold text-gray-600">Soft UI</span>
        <div className="flex items-center gap-2">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`
                px-4 py-2 text-sm rounded-lg transition-all
                ${link.active
                  ? "text-gray-700 font-medium shadow-[inset_3px_3px_6px_#bebebe,inset_-3px_-3px_6px_#ffffff]"
                  : "text-gray-500 hover:text-gray-700 shadow-[3px_3px_6px_#bebebe,-3px_-3px_6px_#ffffff] hover:shadow-[2px_2px_4px_#bebebe,-2px_-2px_4px_#ffffff]"}
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
