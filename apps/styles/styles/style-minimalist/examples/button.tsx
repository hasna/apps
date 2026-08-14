// Minimalist Button — flat, no gradient, subtle hover state
export function Button({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  if (variant === "secondary") {
    return (
      <button
        onClick={onClick}
        className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-sm hover:border-neutral-500 hover:text-neutral-900 transition-colors"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm text-white bg-neutral-900 rounded-sm hover:bg-neutral-700 transition-colors"
    >
      {children}
    </button>
  );
}
