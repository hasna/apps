// Material Card — elevation-1 shadow, rounded-xl, surface color
export function Card({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: string;
}) {
  return (
    <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
      <div className="p-4">
        <h3 className="text-base font-medium text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
      </div>
      {action && (
        <div className="px-4 pb-3 flex justify-end">
          <button className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors uppercase tracking-wide">
            {action}
          </button>
        </div>
      )}
    </div>
  );
}
