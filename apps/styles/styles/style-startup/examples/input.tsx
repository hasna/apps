// Startup Input — rounded-xl, soft purple focus ring
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
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5
          text-sm text-gray-900 placeholder:text-gray-400
          shadow-sm
          focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400
          transition-shadow
        "
      />
    </div>
  );
}
