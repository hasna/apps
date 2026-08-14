// Neubrutalism Button — border-2, hard shadow, press animation
export function Button({
  children,
  onClick,
  color = "yellow",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: "yellow" | "pink" | "green" | "white";
}) {
  const colors = {
    yellow: "bg-yellow-300 hover:bg-yellow-400",
    pink: "bg-pink-300 hover:bg-pink-400",
    green: "bg-green-300 hover:bg-green-400",
    white: "bg-white hover:bg-gray-50",
  };
  return (
    <button
      onClick={onClick}
      className={`
        px-5 py-2.5 text-sm font-bold text-black
        border-2 border-black
        shadow-[4px_4px_0_0_#000]
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#000]
        active:translate-x-[4px] active:translate-y-[4px] active:shadow-none
        transition-all
        ${colors[color]}
      `}
    >
      {children}
    </button>
  );
}
