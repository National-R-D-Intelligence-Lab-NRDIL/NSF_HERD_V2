"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell, ReferenceLine, Label, LabelList,
} from "recharts";
import {
  getFieldPortfolio, getFieldDrilldown, getFieldMomentum, getFieldPeerComparison,
} from "@/lib/api";
import type {
  FieldPortfolioRow, FieldDrilldownRow, FieldMomentumRow, FieldPeerComparisonRow,
} from "@/lib/types";
import { formatDollars, formatPct } from "@/lib/format";
import Card from "./Card";
import KpiCard from "./KpiCard";

interface Props {
  instId: string;
  startYear: number;
  endYear: number;
  customPeerIds: string[];
}

const STANDALONE_PARENTS = new Set(["cs", "math", "psychology", "other_sciences"]);
const FIELD_SHORT_LABELS: Record<string, string> = {
  cs: "Computer Science",
  engineering: "Engineering",
  geosciences: "Geosciences",
  life_sciences: "Life Sciences",
  math: "Math & Statistics",
  physical_sciences: "Physical Sciences",
  psychology: "Psychology",
  social_sciences: "Social Sciences",
  other_sciences: "Other Sciences",
  non_se: "Non-S&E",
};
const N_PEERS = 10;

export default function PortfolioTab({ instId, startYear, endYear, customPeerIds }: Props) {
  const customPeerMode = customPeerIds.length > 0;
  const [portfolio, setPortfolio] = useState<FieldPortfolioRow[]>([]);
  const [momentum, setMomentum] = useState<FieldMomentumRow[]>([]);
  const [comparison, setComparison] = useState<FieldPeerComparisonRow[]>([]);
  const [drilldowns, setDrilldowns] = useState<Record<string, FieldDrilldownRow[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const peerOpts = customPeerMode ? { peerIds: customPeerIds } : { n: N_PEERS };
    Promise.all([
      getFieldPortfolio(instId, endYear),
      getFieldMomentum(instId, startYear, endYear),
      getFieldPeerComparison(instId, endYear, peerOpts).catch(() => ({ comparison: [], custom_peer_mode: customPeerMode })),
    ])
      .then(([p, m, c]) => {
        setPortfolio(p);
        setMomentum(m);
        setComparison(c.comparison);
        setDrilldowns({});
      })
      .catch((e) => setError(String(e)));
  }, [instId, startYear, endYear, customPeerMode, customPeerIds]);

  const loadDrilldown = (fieldCode: string) => {
    if (drilldowns[fieldCode]) return;
    getFieldDrilldown(instId, fieldCode, endYear)
      .then((rows) => setDrilldowns((d) => ({ ...d, [fieldCode]: rows })))
      .catch((e) => setError(String(e)));
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!portfolio.length) return <p className="text-sm text-gray-500">Loading…</p>;

  const display = portfolio.map((p) => ({
    ...p,
    label: FIELD_SHORT_LABELS[p.field_code] ?? p.field_name,
  }));

  const momPlot = momentum
    .filter((m) => m.cagr_pct !== null)
    .map((m) => ({ ...m, label: FIELD_SHORT_LABELS[m.field_code] ?? m.field_name, size: Math.max(m.field_total, 100_000) }));

  const medX = momPlot.length ? median(momPlot.map((m) => m.field_share_pct)) : 0;
  const medY = momPlot.length ? median(momPlot.map((m) => m.cagr_pct as number)) : 0;

  const fastest = momPlot.length ? momPlot.reduce((a, b) => ((b.cagr_pct as number) > (a.cagr_pct as number) ? b : a)) : null;
  const largest = momPlot.length ? momPlot.reduce((a, b) => (b.field_total > a.field_total ? b : a)) : null;
  const mostFederal = portfolio.length
    ? portfolio.reduce((a, b) => (b.federal / b.field_total > a.federal / a.field_total ? b : a))
    : null;

  return (
    <div className="space-y-8">
      {customPeerMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          📌 Custom peer mode — {customPeerIds.length} institution{customPeerIds.length === 1 ? "" : "s"} selected.
        </div>
      )}

      {/* Section 1: Portfolio Overview — stacked federal/nonfederal bar */}
      <Card title={`Portfolio Overview — FY${endYear}`}>
        <ResponsiveContainer width="100%" height={Math.max(280, display.length * 40)}>
          <BarChart data={display} layout="vertical" margin={{ left: 10, right: 140, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => formatDollars(v)} tick={{ fontSize: 12, fill: "#64748b" }} />
            <YAxis type="category" dataKey="label" width={130} reversed tick={{ fontSize: 12, fill: "#374151" }} />
            <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
            <Bar dataKey="federal" name="Federal" stackId="a" fill="#2563eb" />
            <Bar dataKey="nonfederal" name="Nonfederal" stackId="a" fill="#93c5fd">
              <LabelList
                dataKey="field_total"
                position="right"
                content={(props) => {
                  const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                  const row = display[index];
                  if (!row) return null;
                  return (
                    <text x={x + width + 8} y={y + height / 2} dy={4} fontSize={11} fill="#374151">
                      {formatDollars(row.field_total)} ({formatPct(row.field_share_pct)})
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> Federal</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-200" /> Nonfederal</span>
        </div>
      </Card>

      {/* Section 2: Field Momentum quadrant scatter */}
      {momPlot.length > 0 && (
        <Card
          title={`Field Momentum — ${startYear}–${endYear}`}
          caption="Each bubble is a research field. Right = larger share of portfolio. Up = faster growth. Fields in the upper-right are your strategic strengths."
        >
          <ResponsiveContainer width="100%" height={420}>
            <ScatterChart margin={{ top: 30, right: 30, bottom: 30, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" dataKey="field_share_pct" name="Portfolio Share" unit="%" tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "Portfolio Share (%)", position: "insideBottom", offset: -15, fontSize: 12, fill: "#64748b" }} />
              <YAxis type="number" dataKey="cagr_pct" name="CAGR" unit="%" tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: `${endYear - startYear}-Year CAGR (%)`, angle: -90, position: "insideLeft", fontSize: 12, fill: "#64748b" }} />
              <ZAxis type="number" dataKey="size" range={[80, 2000]} name="Total R&D" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }}
                formatter={(value, name) => (name === "Total R&D" ? formatDollars(Number(value)) : `${value}%`)}
                labelFormatter={() => ""}
              />
              <ReferenceLine y={medY} stroke="#d1d5db" strokeDasharray="3 3" />
              <ReferenceLine x={medX} stroke="#d1d5db" strokeDasharray="3 3">
                <Label value="Core Strengths" position="insideTopRight" fill="#9ca3af" fontSize={10} />
                <Label value="Emerging" position="insideTopLeft" fill="#9ca3af" fontSize={10} />
                <Label value="Established Base" position="insideBottomRight" fill="#9ca3af" fontSize={10} />
                <Label value="Smaller Base" position="insideBottomLeft" fill="#9ca3af" fontSize={10} />
              </ReferenceLine>
              <Scatter data={momPlot} fill="#2563eb" fillOpacity={0.7}>
                {momPlot.map((entry) => (
                  <Cell key={entry.field_code} fill="#2563eb" />
                ))}
                <LabelList dataKey="label" position="top" style={{ fontSize: 10, fill: "#374151" }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {fastest && (
              <KpiCard label="Fastest Growing" value={fastest.label} sublabel={`↑ ${formatPct(fastest.cagr_pct)} CAGR`} trend="up" />
            )}
            {largest && (
              <KpiCard label="Largest Field" value={largest.label} sublabel={`${formatPct(largest.field_share_pct)} of portfolio`} trend="neutral" />
            )}
            {mostFederal && (
              <KpiCard
                label="Most Federal"
                value={FIELD_SHORT_LABELS[mostFederal.field_code] ?? mostFederal.field_name}
                sublabel={`${formatPct(100 * mostFederal.federal / mostFederal.field_total)} federal`}
                trend="neutral"
              />
            )}
          </div>
        </Card>
      )}

      {/* Section 3: Sub-field Drill-Down */}
      <Card title={`Sub-field Drill-Down — FY${endYear}`} caption="Expand a field to see its component disciplines.">
        <div className="space-y-2">
          {portfolio
            .filter((p) => !STANDALONE_PARENTS.has(p.field_code))
            .map((p) => (
              <details
                key={p.field_code}
                className="rounded-lg border border-slate-200"
                onToggle={(e) => (e.target as HTMLDetailsElement).open && loadDrilldown(p.field_code)}
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {FIELD_SHORT_LABELS[p.field_code] ?? p.field_name} — {formatDollars(p.field_total)} ({formatPct(p.field_share_pct)})
                </summary>
                <div className="border-t border-slate-200 px-3 py-2">
                  {!drilldowns[p.field_code] ? (
                    <p className="text-xs text-slate-400">Loading…</p>
                  ) : drilldowns[p.field_code].length === 0 ? (
                    <p className="text-xs text-slate-400">No sub-field breakdown for this field.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead>
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-500">Discipline</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-500">Total</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-500">Federal %</th>
                            <th className="px-2 py-1.5 text-right font-medium text-slate-500">Share of Parent</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {drilldowns[p.field_code].map((row) => {
                            const parentPrefix = p.field_name.split(",")[0];
                            const discipline = capitalize(row.field_name.replace(`${parentPrefix}, `, ""));
                            const federalPct = row.total > 0 ? (100 * row.federal) / row.total : null;
                            return (
                              <tr key={row.field_code}>
                                <td className="px-2 py-1.5">{discipline}</td>
                                <td className="px-2 py-1.5 text-right">{formatDollars(row.total)}</td>
                                <td className="px-2 py-1.5 text-right">{federalPct === null ? "N/A" : formatPct(federalPct)}</td>
                                <td className="px-2 py-1.5 text-right">{formatPct(row.share_of_parent)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            ))}
        </div>
      </Card>

      {/* Section 4: Portfolio Distinctiveness — diverging bar vs peers */}
      {comparison.length > 0 && (
        <Card title={`Portfolio Distinctiveness — FY${endYear}`}>
          {customPeerMode ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>Custom peer set active</strong> — comparison reflects your manually selected institutions, not algorithmically matched peers.
              <p className="mt-1 text-amber-700">
                How your field mix compares to your {customPeerIds.length} custom-selected peers. Positive = you invest a larger share than peers.
              </p>
            </div>
          ) : (
            <p className="mb-3 text-xs text-slate-500">
              How your field mix compares to your {N_PEERS} nearest peers. Positive = you invest a larger share than peers.
            </p>
          )}
          <ResponsiveContainer width="100%" height={Math.max(280, comparison.length * 36)}>
            <BarChart
              data={[...comparison].map((c) => ({ ...c, label: FIELD_SHORT_LABELS[c.field_code] ?? c.field_name })).sort((a, b) => a.difference - b.difference)}
              layout="vertical"
              margin={{ left: 10, right: 60, top: 10, bottom: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "Difference (percentage points)", position: "insideBottom", offset: -20, fontSize: 12, fill: "#64748b" }} />
              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12, fill: "#374151" }} />
              <Tooltip
                formatter={(v, _n, item) => [`${formatPct(Number(v))}`, `You: ${formatPct(item.payload.your_pct)} · Peers: ${formatPct(item.payload.peer_avg_pct)}`]}
                contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }}
              />
              <ReferenceLine x={0} stroke="#374151" />
              <Bar dataKey="difference" name="Difference">
                {comparison.map((c) => (
                  <Cell key={c.field_code} fill={c.difference >= 0 ? "#2563eb" : "#93c5fd"} />
                ))}
                <LabelList dataKey="difference" position="right" formatter={(v: unknown) => `${Number(v) >= 0 ? "+" : ""}${v}pp`} style={{ fontSize: 11, fill: "#374151" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
