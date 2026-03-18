// Editorial Card — serif font, generous line-height, rule divider
export function Card({
  category,
  title,
  excerpt,
}: {
  category: string;
  title: string;
  excerpt: string;
}) {
  return (
    <article className="py-6 border-t border-neutral-300">
      <p className="text-xs font-sans uppercase tracking-widest text-neutral-400 mb-3">
        {category}
      </p>
      <h3 className="font-serif text-xl font-bold text-neutral-900 leading-snug mb-3">
        {title}
      </h3>
      <p className="font-serif text-sm text-neutral-600 leading-loose">{excerpt}</p>
      <a
        href="#"
        className="mt-4 inline-block text-xs font-sans uppercase tracking-widest text-neutral-900 border-b border-neutral-900 hover:text-neutral-500 hover:border-neutral-500 transition-colors"
      >
        Read more
      </a>
    </article>
  );
}
