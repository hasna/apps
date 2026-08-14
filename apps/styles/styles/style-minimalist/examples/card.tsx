// Minimalist Card — thin border, generous padding, no shadow
export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="border border-neutral-200 rounded-sm p-6">
      <h3 className="text-neutral-900 font-medium text-sm tracking-tight mb-2">{title}</h3>
      <p className="text-neutral-500 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
