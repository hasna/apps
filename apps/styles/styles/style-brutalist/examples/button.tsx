// Brutalist Button — thick border, offset shadow, uppercase monospace
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
        px-6 py-3 font-mono font-bold uppercase tracking-widest text-sm
        border-4 border-black bg-white text-black
        shadow-[4px_4px_0_0_#000]
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#000]
        active:translate-x-[4px] active:translate-y-[4px] active:shadow-none
        transition-all
      "
    >
      {children}
    </button>
  );
}
