// Editorial Input — underline only, serif label, clean and typographic
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
      <label className="font-serif text-sm italic text-neutral-600">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          border-b border-neutral-400 bg-transparent py-2 px-0
          font-serif text-sm text-neutral-900
          placeholder:text-neutral-300 placeholder:italic
          focus:outline-none focus:border-neutral-900
          transition-colors
        "
      />
    </div>
  );
}
