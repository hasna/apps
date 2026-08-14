// Neumorphic Button — raised dual shadow, pressed inset shadow on active
export function Button({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="
        px-6 py-3 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl
        shadow-[6px_6px_12px_#bebebe,-6px_-6px_12px_#ffffff]
        hover:shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]
        active:shadow-[inset_4px_4px_8px_#bebebe,inset_-4px_-4px_8px_#ffffff]
        transition-shadow
        focus:outline-none
      "
    >
      {children}
    </button>
  );
}
