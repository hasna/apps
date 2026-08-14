// Neubrutalism Input — border-2 border-black, focus gets hard shadow, no radius
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
      <label className="text-sm font-bold text-black uppercase tracking-wide">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          border-2 border-black bg-white px-3 py-2.5 text-sm text-black
          placeholder:text-gray-400
          focus:outline-none focus:shadow-[4px_4px_0_0_#000]
          transition-shadow
        "
      />
    </div>
  );
}
