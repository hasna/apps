// Retro Input — chunky border, monospace font, blinking-cursor feel
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
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-xs uppercase tracking-wider text-amber-800">
        &gt; {label}:
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          border-2 border-black bg-amber-50 font-mono text-sm text-black
          px-3 py-2 shadow-[2px_2px_0_0_#000]
          placeholder:text-amber-400
          focus:outline-none focus:bg-yellow-50
          transition-colors
        "
      />
    </div>
  );
}
