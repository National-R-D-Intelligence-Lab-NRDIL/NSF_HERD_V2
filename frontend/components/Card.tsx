interface Props {
  title?: string;
  caption?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Card({ title, caption, children, className = "" }: Props) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
      {caption && <p className="mb-2 mt-0.5 text-xs text-slate-500">{caption}</p>}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </section>
  );
}
