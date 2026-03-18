// Startup Card — rounded-xl, soft shadow, gradient accent border, icon
export function Card({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="relative rounded-xl bg-white p-6 shadow-md border border-gray-100 overflow-hidden">
      {/* Gradient accent top stripe */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-indigo-600" />
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-50 to-indigo-50 text-indigo-600">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
