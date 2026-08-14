// Startup Button — gradient background, rounded-full, with shimmer on hover
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
        className="px-5 py-2.5 text-sm font-semibold text-indigo-600 bg-indigo-50 rounded-full hover:bg-indigo-100 transition-colors"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className="
        px-5 py-2.5 text-sm font-semibold text-white rounded-full
        bg-gradient-to-r from-purple-500 to-indigo-600
        hover:from-purple-600 hover:to-indigo-700
        shadow-md shadow-indigo-200
        hover:shadow-lg hover:shadow-indigo-300
        transition-all
      "
    >
      {children}
    </button>
  );
}
