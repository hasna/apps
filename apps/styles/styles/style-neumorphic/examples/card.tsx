// Neumorphic Card — extruded from bg-gray-100, dual shadow
export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-gray-100 rounded-xl p-6 shadow-[8px_8px_16px_#bebebe,-8px_-8px_16px_#ffffff]">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}
