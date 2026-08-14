// Neubrutalism Card — border-2 border-black, hard drop shadow, bold fill color
export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-2 border-black bg-yellow-300 p-5 shadow-[4px_4px_0_0_#000]">
      <h3 className="font-bold text-base text-black mb-2">{title}</h3>
      <p className="text-sm text-black leading-relaxed">{description}</p>
    </div>
  );
}
