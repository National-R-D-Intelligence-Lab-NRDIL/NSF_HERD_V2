interface Props {
  label: string;
  value: string;
  sublabel?: string;
  trend?: "up" | "down" | "neutral";
}

const TREND_COLOR: Record<string, string> = {
  up: "text-emerald-600",
  down: "text-rose-600",
  neutral: "text-slate-500",
};

const TREND_ARROW: Record<string, string> = {
  up: "↑",
  down: "↓",
  neutral: "",
};

export default function KpiCard({ label, value, sublabel, trend = "neutral" }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition-shadow hover:shadow-md">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold leading-tight text-slate-900">{value}</p>
      {sublabel && (
        <p className={`mt-1 text-[13px] ${TREND_COLOR[trend]}`}>
          {TREND_ARROW[trend]} {sublabel}
        </p>
      )}
    </div>
  );
}
