"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, ReferenceLine, LabelList,
} from "recharts";
import {
  getAgencyBreakdown, getConcentration, getAgencyTrend, getAgencyPeerComparison,
} from "@/lib/api";
import type {
  AgencyRow, AgencyTrendRow, ConcentrationResponse, AgencyPeerComparisonRow,
} from "@/lib/types";
import { formatDollars, formatDollarsFull, formatPct } from "@/lib/format";
import KpiCard from "./KpiCard";
import Card from "./Card";

interface Props {
  instId: string;
  startYear: number;
  endYear: number;
  customPeerIds: string[];
}

const DONUT_COLORS = ["#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE", "#EFF6FF"];
const AGENCY_COLORS: Record<string, string> = {
  DOD: "#1E40AF", DOE: "#B45309", HHS: "#047857", NASA: "#7C3AED",
  NSF: "#DC2626", USDA: "#65A30D", "Other agencies": "#6B7280",
};
const N_PEERS = 10;

export default function FederalTab({ instId, startYear, endYear, customPeerIds }: Props) {
  const customPeerMode = customPeerIds.length > 0;
  const [agencies, setAgencies] = useState<AgencyRow[]>([]);
  const [concentration, setConcentration] = useState<ConcentrationResponse | null>(null);
  const [trend, setTrend] = useState<AgencyTrendRow[]>([]);
  const [comparison, setComparison] = useState<AgencyPeerComparisonRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const peerOpts = customPeerMode ? { peerIds: customPeerIds } : { n: N_PEERS };
    Promise.all([
      getAgencyBreakdown(instId, endYear),
      getConcentration(instId, endYear),
      getAgencyTrend(instId, startYear, endYear),
      getAgencyPeerComparison(instId, endYear, peerOpts).catch(() => ({ comparison: [], custom_peer_mode: customPeerMode })),
    ])
      .then(([a, c, t, cmp]) => {
        setAgencies(a);
        setConcentration(c);
        setTrend(t);
        setComparison(cmp.comparison);
      })
      .catch((e) => setError(String(e)));
  }, [instId, startYear, endYear, customPeerMode, customPeerIds]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!agencies.length) return <p className="text-sm text-gray-500">Loading…</p>;

  const growthRows = agencyCodes(trend).map((code) => {
    const rows = trend.filter((t) => t.agency_code === code).sort((a, b) => a.year - b.year);
    if (rows.length < 2) return null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first.amount <= 0 || last.year === first.year) return null;
    const changePct = Math.round((last.amount / first.amount - 1) * 100);
    return {
      agency: first.agency_name,
      firstYear: first.year,
      firstVal: first.amount,
      lastYear: last.year,
      lastVal: last.amount,
      changePct,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="space-y-8">
      {customPeerMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          📌 Custom peer mode — {customPeerIds.length} institution{customPeerIds.length === 1 ? "" : "s"} selected.
        </div>
      )}

      {/* Section 1: Agency Breakdown — donut + table */}
      <Card title={`Federal Agency Breakdown — FY${endYear}`}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={agencies} dataKey="amount" nameKey="agency_name" cx="50%" cy="50%" innerRadius={70} outerRadius={130} label={(d) => `${d.percent ? (d.percent * 100).toFixed(0) : 0}%`}>
                {agencies.map((entry, i) => (
                  <Cell key={entry.agency_code} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Agency</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Amount</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agencies.map((a) => (
                  <tr key={a.agency_code}>
                    <td className="px-3 py-2">{a.agency_name}</td>
                    <td className="px-3 py-2 text-right">{formatDollarsFull(a.amount)}</td>
                    <td className="px-3 py-2 text-right">{formatPct(a.pct_of_federal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* Section 2: Funding Diversification */}
      {concentration && (
        <Card title={`Funding Diversification — FY${endYear}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Diversification" value={`${concentration.diversification_score}%`} sublabel="0% = one agency, 100% = perfectly even" />
            <KpiCard
              label="Top Agency"
              value={concentration.top_agency.replace("Dept of ", "").replace(" (incl. NIH)", "")}
              sublabel={`${formatPct(concentration.top_agency_pct)} of federal`}
            />
            <KpiCard
              label="National Position"
              value={`${concentration.national_percentile}th pctl`}
              sublabel={`Among ${concentration.total_institutions} institutions with federal funding`}
            />
          </div>
        </Card>
      )}

      {/* Section 3: Agency Funding Trends */}
      {trend.length > 0 && (
        <Card title="Agency Funding Trends" caption={`Federal funding by agency, ${startYear}–${endYear}.`}>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={groupByYear(trend)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#64748b" }} />
              <YAxis tickFormatter={(v) => formatDollars(Number(v))} tick={{ fontSize: 12, fill: "#64748b" }} />
              <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
              <Legend />
              {agencyCodes(trend).map((code) => (
                <Line
                  key={code}
                  type="monotone"
                  dataKey={code}
                  name={agencyName(trend, code)}
                  stroke={AGENCY_COLORS[code] ?? "#6B7280"}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {growthRows.length > 0 && (
            <details className="mt-4 rounded-lg border border-slate-200">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Agency Growth Summary
              </summary>
              <div className="overflow-x-auto border-t border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">Agency</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">{growthRows[0]?.firstYear}</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">{growthRows[0]?.lastYear}</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {growthRows.map((r) => (
                      <tr key={r.agency}>
                        <td className="px-3 py-2">{r.agency}</td>
                        <td className="px-3 py-2 text-right">{formatDollarsFull(r.firstVal)}</td>
                        <td className="px-3 py-2 text-right">{formatDollarsFull(r.lastVal)}</td>
                        <td className="px-3 py-2 text-right">{r.changePct >= 0 ? "+" : ""}{r.changePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Card>
      )}

      {/* Section 4: Agency Distinctiveness — diverging bar vs peers */}
      {comparison.length > 0 && (
        <Card title={`Agency Distinctiveness — FY${endYear}`}>
          {customPeerMode ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>Custom peer set active</strong> — comparison reflects your manually selected institutions, not algorithmically matched peers.
              <p className="mt-1 text-amber-700">
                How your federal agency mix compares to your {customPeerIds.length} custom-selected peers. Positive = you rely more on this agency than peers do.
              </p>
            </div>
          ) : (
            <p className="mb-3 text-xs text-slate-500">
              How your federal agency mix compares to your {N_PEERS} nearest peers. Positive = you rely more on this agency than peers do.
            </p>
          )}
          <ResponsiveContainer width="100%" height={Math.max(240, comparison.length * 40)}>
            <BarChart
              data={[...comparison].sort((a, b) => a.difference - b.difference)}
              layout="vertical"
              margin={{ left: 10, right: 60, top: 10, bottom: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "Difference (percentage points)", position: "insideBottom", offset: -20, fontSize: 12, fill: "#64748b" }} />
              <YAxis type="category" dataKey="agency_name" width={140} tick={{ fontSize: 12, fill: "#374151" }} />
              <Tooltip
                formatter={(v, _n, item) => [`${formatPct(Number(v))}`, `You: ${formatPct(item.payload.your_pct)} · Peers: ${formatPct(item.payload.peer_avg_pct)}`]}
                contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }}
              />
              <ReferenceLine x={0} stroke="#374151" />
              <Bar dataKey="difference" name="Difference">
                {comparison.map((c) => (
                  <Cell key={c.agency_code} fill={c.difference >= 0 ? "#2563eb" : "#93c5fd"} />
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

function agencyCodes(trend: AgencyTrendRow[]): string[] {
  return Array.from(new Set(trend.map((t) => t.agency_code)));
}

function agencyName(trend: AgencyTrendRow[], code: string): string {
  return trend.find((t) => t.agency_code === code)?.agency_name ?? code;
}

function groupByYear(trend: AgencyTrendRow[]): Record<string, number | string>[] {
  const years = Array.from(new Set(trend.map((t) => t.year))).sort((a, b) => a - b);
  return years.map((year) => {
    const row: Record<string, number | string> = { year };
    trend
      .filter((t) => t.year === year)
      .forEach((t) => {
        row[t.agency_code] = t.amount;
      });
    return row;
  });
}
