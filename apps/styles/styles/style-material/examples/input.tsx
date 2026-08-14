// Material Input — outlined variant with floating label via CSS trick
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
    <div className="relative w-full">
      <input
        type="text"
        id={`input-${label}`}
        placeholder={placeholder ?? " "}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          peer block w-full rounded-md border border-gray-400 bg-white px-3 pt-5 pb-2
          text-sm text-gray-900
          placeholder-transparent
          focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600
          transition-colors
        "
      />
      <label
        htmlFor={`input-${label}`}
        className="
          absolute left-3 top-1 text-xs text-gray-500 transition-all
          peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:text-gray-400
          peer-focus:top-1 peer-focus:text-xs peer-focus:text-blue-600
        "
      >
        {label}
      </label>
    </div>
  );
}
