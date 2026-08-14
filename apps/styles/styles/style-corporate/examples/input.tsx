// Corporate Input — standard border, label above, helper text below
export function Input({
  label,
  placeholder,
  helperText,
  error,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  helperText?: string;
  error?: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`
          block w-full rounded-md border px-3 py-2 text-sm text-gray-900
          placeholder:text-gray-400 shadow-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          ${error ? "border-red-300 focus:ring-red-500 focus:border-red-500" : "border-gray-300"}
        `}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helperText && !error && <p className="text-xs text-gray-500">{helperText}</p>}
    </div>
  );
}
