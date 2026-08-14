// Editorial Button — minimal, serif or underline-style CTA
export function Button({
  children,
  onClick,
  variant = "underline",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "underline" | "outlined";
}) {
  if (variant === "outlined") {
    return (
      <button
        onClick={onClick}
        className="px-5 py-2 font-serif text-sm text-neutral-900 border border-neutral-900 hover:bg-neutral-900 hover:text-white transition-colors"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="font-sans text-xs uppercase tracking-widest text-neutral-900 border-b border-neutral-900 pb-0.5 hover:text-neutral-500 hover:border-neutral-500 transition-colors bg-transparent"
    >
      {children}
    </button>
  );
}
