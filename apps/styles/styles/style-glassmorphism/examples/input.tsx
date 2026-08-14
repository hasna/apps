// Glassmorphism Input — translucent bg, blur, white border
export function Input({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-white/80 uppercase tracking-wide">
        {label}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          w-full bg-white/10 backdrop-blur-sm border border-white/20
          rounded-xl px-4 py-2.5 text-sm text-white
          placeholder:text-white/40
          focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/50
          transition-all
        "
      />
    </div>
  );
}
