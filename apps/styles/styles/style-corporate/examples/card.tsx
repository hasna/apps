// Corporate Card — subtle shadow, moderate radius, structured header/body/footer
export function Card({
  title,
  description,
  footer,
}: {
  title: string;
  description: string;
  footer?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
      </div>
      {footer && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500">{footer}</p>
        </div>
      )}
    </div>
  );
}
