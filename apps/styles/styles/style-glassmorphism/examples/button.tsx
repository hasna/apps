// Glassmorphism Button — translucent bg, blur, white border
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
        px-5 py-2.5 text-sm font-semibold text-white
        bg-white/20 backdrop-blur-sm border border-white/30
        rounded-xl shadow-md
        hover:bg-white/30 hover:border-white/50
        active:bg-white/10
        transition-all
      "
    >
      {children}
    </button>
  );
}
