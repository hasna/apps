// Glassmorphism Card — backdrop-blur, translucent bg, white/20 border
export function Card({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 p-6 shadow-xl">
      <h3 className="text-white font-semibold text-sm mb-2 tracking-tight">{title}</h3>
      <p className="text-white/70 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
