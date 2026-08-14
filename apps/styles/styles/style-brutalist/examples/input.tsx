// Brutalist Input — thick border, no border radius, monospace font
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
      <label className="font-mono font-bold text-xs uppercase tracking-widest text-black">
        {label}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          border-4 border-black bg-white font-mono text-sm text-black px-3 py-2
          placeholder:text-neutral-400
          focus:outline-none focus:shadow-[4px_4px_0_0_#000]
          transition-shadow
        "
      />
    </div>
  );
}
