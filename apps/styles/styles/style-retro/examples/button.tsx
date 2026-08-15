// Retro Button — chunky border, pixel font feel, sharp corners, offset shadow
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
        px-5 py-2.5 font-mono font-bold text-xs uppercase tracking-widest
        bg-amber-400 text-black border-2 border-black
        shadow-[3px_3px_0_0_#000]
        hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#000]
        active:translate-x-[3px] active:translate-y-[3px] active:shadow-none
        transition-all
      "
    >
      [ {children} ]
    </button>
  );
}
