// Material Button — filled style, rounded-full, ripple hint
export function Button({
  children,
  onClick,
  variant = "filled",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "filled" | "tonal" | "outlined" | "text";
}) {
  const base = "px-6 py-2.5 text-sm font-medium rounded-full uppercase tracking-wide transition-all focus:outline-none";
  const variants = {
    filled: `${base} bg-blue-600 text-white hover:bg-blue-700 shadow hover:shadow-md active:shadow-sm`,
    tonal: `${base} bg-blue-100 text-blue-700 hover:bg-blue-200`,
    outlined: `${base} border border-blue-600 text-blue-600 hover:bg-blue-50`,
    text: `${base} text-blue-600 hover:bg-blue-50 px-3`,
  };
  return (
    <button onClick={onClick} className={variants[variant]}>
      {children}
    </button>
  );
}
