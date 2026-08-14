// Neumorphic Input — inset shadow (pressed), bg matches container
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
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          w-full bg-gray-100 rounded-xl px-4 py-2.5
          text-sm text-gray-700 placeholder:text-gray-400
          shadow-[inset_4px_4px_8px_#bebebe,inset_-4px_-4px_8px_#ffffff]
          focus:outline-none focus:shadow-[inset_6px_6px_12px_#b8b8b8,inset_-6px_-6px_12px_#ffffff]
          border-none
          transition-shadow
        "
      />
    </div>
  );
}
