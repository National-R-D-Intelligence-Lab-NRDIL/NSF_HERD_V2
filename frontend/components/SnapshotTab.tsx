"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, LineChart, Line, ReferenceLine, PieChart, Pie, Cell, LabelList,
  ComposedChart, Area,
} from "recharts";
import {
  getInstitution, getRankTrend, getAnchorView, getFundingBreakdown,
  getStateRanking, getGap, getPeerTrend, getStrategicInsight, getPeerMovement,
} from "@/lib/api";
import type {
  InstitutionDetail, RankPoint, AnchorResponse, FundingBreakdown,
  StateRanking, GapResponse, PeerTrendResponse, TrendStats, StrategicInsight,
  PeerFilters, PeerMovementResponse,
} from "@/lib/types";
import { formatDollars, formatDollarsFull, formatPct, formatRank } from "@/lib/format";
import KpiCard from "./KpiCard";
import Card from "./Card";
import YearCompare from "./YearCompare";

interface Props {
  instId: string;
  startYear: number;
  endYear: number;
  customPeerIds: string[];
  peerFilters?: PeerFilters;
}

const N_PEERS = 10;
const MIN_YEAR = 2010;
const MAX_YEAR = 2024;
const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5", "#0d9488", "#be123c"];
const METRIC_LABELS: Record<string, string> = {
  total_rd: "Total R&D", federal: "Federal", state_local: "State/Local",
  business: "Business", nonprofit: "Nonprofit", institutional: "Institutional",
  other_sources: "Other",
};
const SOURCE_LABELS: Record<string, string> = {
  federal: "Federal", institutional: "Institutional", state_local: "State/Local",
  business: "Business", nonprofit: "Nonprofit", other_sources: "Other",
};

export default function SnapshotTab({ instId, startYear, endYear, customPeerIds, peerFilters }: Props) {
  const customPeerMode = customPeerIds.length > 0;

  const [detail, setDetail] = useState<InstitutionDetail | null>(null);
  const [rankTrend, setRankTrend] = useState<RankPoint[]>([]);
  const [anchor, setAnchor] = useState<AnchorResponse | null>(null);
  const [funding, setFunding] = useState<FundingBreakdown | null>(null);
  const [stateRank, setStateRank] = useState<StateRanking | null>(null);
  const [gap, setGap] = useState<GapResponse | null>(null);
  const [peerTrend, setPeerTrend] = useState<PeerTrendResponse | null>(null);
  const [movement, setMovement] = useState<PeerMovementResponse | null>(null);
  const [insight, setInsight] = useState<StrategicInsight | null>(null);
  const [growthView, setGrowthView] = useState<"summary" | "detail">("summary");
  const [showCompare, setShowCompare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const peerOpts = customPeerMode
      ? { peerIds: customPeerIds }
      : { n: N_PEERS, filters: peerFilters };
    Promise.all([
      getInstitution(instId, endYear),
      getRankTrend(instId, startYear, endYear),
      getAnchorView(instId, endYear),
      getFundingBreakdown(instId, startYear, endYear),
      getStateRanking(instId, endYear),
      getGap(instId, peerOpts),
      getPeerTrend(instId, startYear, endYear, peerOpts),
      getPeerMovement(instId, startYear, endYear, peerOpts),
      getStrategicInsight(instId, startYear, endYear, peerOpts).catch(() => null),
    ])
      .then(([d, rt, a, f, sr, g, pt, mv, ins]) => {
        setDetail(d);
        setRankTrend(rt);
        setAnchor(a);
        setFunding(f);
        setStateRank(sr);
        setGap(g);
        setPeerTrend(pt);
        setMovement(mv);
        setInsight(ins);
      })
      .catch((e) => setError(String(e)));
  }, [instId, startYear, endYear, customPeerMode, customPeerIds, peerFilters]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-gray-500">Loading…</p>;

  const nYears = endYear - startYear;
  const first = rankTrend[0];
  const current = rankTrend[rankTrend.length - 1];
  const execMetrics = first && current ? {
    currentRank: current.national_rank,
    rankChange: first.national_rank - current.national_rank,
    currentRd: current.total_rd,
    rdChange: current.total_rd - first.total_rd,
  } : null;

  const activePeerLabel = peerGroupLabel(customPeerMode, customPeerIds.length, peerTrend, N_PEERS);
  const callout = generateLandingCallout(execMetrics, peerTrend?.stats ?? null, insight, nYears, customPeerMode, activePeerLabel);

  return (
    <div className="space-y-8">
      {customPeerMode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          📌 Custom peer mode — {customPeerIds.length} institution{customPeerIds.length === 1 ? "" : "s"} selected. Peer Analysis below reflects your manually selected peers.
        </div>
      )}

      {/* Landing briefing: 3 KPIs. CAGR comparison follows the currently active peer set (custom, filtered, or default benchmark). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label={`National Rank — FY${endYear}`}
          value={formatRank(execMetrics?.currentRank)}
          sublabel={execMetrics && execMetrics.rankChange !== 0 ? `${execMetrics.rankChange > 0 ? "+" : ""}${execMetrics.rankChange} positions since ${startYear}` : undefined}
          trend={execMetrics && execMetrics.rankChange > 0 ? "up" : execMetrics && execMetrics.rankChange < 0 ? "down" : "neutral"}
        />
        <KpiCard
          label={`Total R&D — FY${endYear}`}
          value={formatDollars(execMetrics?.currentRd)}
          sublabel={execMetrics ? formatDollars(execMetrics.rdChange) : undefined}
          trend={execMetrics && execMetrics.rdChange >= 0 ? "up" : "down"}
        />
        <KpiCard
          label={`${nYears}-Year CAGR`}
          value={peerTrend ? formatPct(peerTrend.stats.target_cagr) : "—"}
          sublabel={peerTrend ? `${(peerTrend.stats.target_cagr - peerTrend.stats.peer_avg_cagr) >= 0 ? "+" : ""}${(peerTrend.stats.target_cagr - peerTrend.stats.peer_avg_cagr).toFixed(1)}pp vs ${activePeerLabel}` : undefined}
          trend={peerTrend && peerTrend.stats.target_cagr >= peerTrend.stats.peer_avg_cagr ? "up" : "down"}
        />
      </div>

      {callout && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          {callout}
        </div>
      )}

      {/* Strategic Insight */}
      <Card title="Strategic Insight">
        {insight?.top_field || insight?.top_agency ? (
          <div className="mb-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {insight.top_field && (
              <KpiCard label="Largest Research Field" value={insight.top_field} sublabel={`${insight.top_field_pct}% of portfolio`} />
            )}
            {insight.top_agency && (
              <KpiCard label="Top Federal Agency" value={insight.top_agency} sublabel={`${insight.top_agency_pct}% of federal`} />
            )}
          </div>
        ) : null}
        {peerTrend && (
          <p className="mb-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-semibold">Peer Position:</span>{" "}
            {peerPositionLabel(peerTrend.stats, customPeerMode, N_PEERS)}
          </p>
        )}
        {insight ? (
          <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
            💡 <span className="font-semibold">Strategic Insight:</span> {insight.insight}
          </p>
        ) : (
          <p className="text-sm text-slate-400">Strategic insight unavailable (GEMINI_API_KEY not configured, or generation failed).</p>
        )}
      </Card>

      {/* Ranking Over Time */}
      <Card title="Ranking Over Time">
        <ResponsiveContainer width="100%" height={Math.max(180, rankTrend.length * 40)}>
          <BarChart data={rankTrend.map((r) => ({ ...r, yearLabel: String(r.year) }))} layout="vertical" margin={{ left: 10, right: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" reversed domain={[0, (max: number) => max + 15]} tickFormatter={(v) => `#${v}`} tick={{ fontSize: 12, fill: "#64748b" }} />
            <YAxis type="category" dataKey="yearLabel" width={40} tick={{ fontSize: 12, fill: "#374151" }} />
            <Tooltip formatter={(v) => `#${v}`} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
            <Bar dataKey="national_rank" radius={[0, 4, 4, 0]}>
              {rankTrend.map((r, i) => (
                <Cell key={r.year} fill={i === rankTrend.length - 1 ? "#2563eb" : "#93c5fd"} />
              ))}
              <LabelList dataKey="national_rank" position="right" formatter={(v: unknown) => `#${v}`} style={{ fontSize: 13, fill: "#374151" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Compare Two Years */}
      <div>
        <button
          type="button"
          onClick={() => setShowCompare((v) => !v)}
          className="text-sm font-medium text-blue-700 hover:text-blue-800"
        >
          {showCompare ? "Hide year comparison ▲" : "Compare two years ▼"}
        </button>
        {showCompare && (
          <div className="mt-3">
            <YearCompare instId={instId} minYear={MIN_YEAR} maxYear={MAX_YEAR} />
          </div>
        )}
      </div>

      {/* Where You Sit Nationally (anchor / competitive band) */}
      {anchor && (
        <Card title={`Where You Sit Nationally (${endYear})`} caption={`of ${anchor.total_institutions} institutions`}>
          <ResponsiveContainer width="100%" height={Math.max(200, anchor.anchors.length * 52)}>
            <BarChart
              data={anchor.anchors.map((a) => ({
                ...a,
                displayName: `${a.is_target ? "► " : ""}${a.name.length < 38 ? a.name : a.name.slice(0, 35) + "…"}`,
                label: `#${a.national_rank}  ${formatDollars(a.total_rd)}`,
              }))}
              layout="vertical"
              margin={{ left: 10, right: 90 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => formatDollars(v)} tick={{ fontSize: 12, fill: "#64748b" }} />
              <YAxis type="category" dataKey="displayName" width={220} tick={{ fontSize: 12, fill: "#374151" }} />
              <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
              <Bar dataKey="total_rd" radius={[0, 4, 4, 0]}>
                {anchor.anchors.map((a) => (
                  <Cell key={a.inst_id} fill={a.is_target ? "#2563eb" : "#9ca3af"} />
                ))}
                <LabelList dataKey="label" position="right" style={{ fontSize: 11, fill: "#374151" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Peer Analysis */}
      {gap && gap.gaps.length > 0 ? (
        <Card>
          <h3 className="text-sm font-semibold text-slate-800">Peer Analysis</h3>
          <p className="mb-3 mt-0.5 text-xs text-slate-500">
            {customPeerMode
              ? `Compared against ${customPeerIds.length} custom-selected peers`
              : `Compared against your ${peerTrend ? peerTrend.stats.total_in_group - 1 : N_PEERS} closest national peers (matched across all funding dimensions)`}
          </p>

          {peerTrend && (
            <div className={`mb-4 grid grid-cols-1 gap-4 ${customPeerMode ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
              <KpiCard label="Your Growth (CAGR)" value={formatPct(peerTrend.stats.target_cagr)} />
              <KpiCard label={customPeerMode ? "Peer Avg Growth (Custom)" : "Peer Avg Growth"} value={formatPct(peerTrend.stats.peer_avg_cagr)} />
              {!customPeerMode && peerTrend.stats.growth_rank !== null && (
                <KpiCard label="Growth Rank" value={`#${peerTrend.stats.growth_rank} of ${peerTrend.stats.total_in_group}`} />
              )}
            </div>
          )}

          <PeerAnalysisSubTabs
            gap={gap}
            peerTrend={peerTrend}
            movement={movement}
            growthView={growthView}
            setGrowthView={setGrowthView}
            customPeerMode={customPeerMode}
            institutionName={detail.name}
          />
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-slate-500">
            Peer analysis is not available for this institution. This can happen when an institution was not included in the most recent HERD survey year.
          </p>
        </Card>
      )}

      {/* Funding Source Analysis */}
      {funding && (
        <Card title="Funding Source Analysis">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">{endYear} Funding Sources</p>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={Object.entries(funding.breakdown).filter(([k]) => k !== "total_rd").map(([k, v]) => ({ name: SOURCE_LABELS[k] ?? k, value: v as number }))}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(d) => d.name}
                  >
                    {Object.keys(funding.breakdown).filter((k) => k !== "total_rd").map((k, i) => (
                      <Cell key={k} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">Federal Share Over Time</p>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={funding.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#64748b" }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: "#64748b" }} />
                  <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
                  <ReferenceLine y={funding.national_median_federal_pct} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `National Median (${funding.national_median_federal_pct}%)`, fontSize: 11, fill: "#ef4444", position: "insideTopRight" }} />
                  <Line type="monotone" dataKey="federal_pct" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      {/* State Competitive Position */}
      {stateRank && (
        <Card title={`Top 10 in ${detail.state}`}>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-2">
            <KpiCard label={`Rank in ${detail.state}`} value={formatRank(stateRank.state_rank)} />
            <KpiCard label="State Market Share" value={formatPct(stateRank.market_share_pct)} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">State Rank</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Institution</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Total R&D</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stateRank.institutions.slice(0, 10).map((r) => (
                  <tr key={r.inst_id} className={r.inst_id === instId ? "bg-blue-50 font-semibold" : ""}>
                    <td className="px-3 py-2">{formatRank(r.state_rank)}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">{formatDollars(r.total_rd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function peerPositionLabel(stats: TrendStats, customPeerMode: boolean, nPeers: number): string {
  const peerLabel = customPeerMode ? "custom peers" : `${nPeers} Benchmark Peers`;
  const diff = stats.target_cagr - stats.peer_avg_cagr;
  if (diff > 5) return `Growing faster than ${peerLabel}`;
  if (diff < -5) return `Growing slower than ${peerLabel}`;
  return `Growth aligned with ${peerLabel}`;
}

function peerGroupLabel(customPeerMode: boolean, customPeerCount: number, peerTrend: PeerTrendResponse | null, nPeers: number): string {
  if (customPeerMode) return `${customPeerCount} custom peer${customPeerCount === 1 ? "" : "s"}`;
  const n = peerTrend ? peerTrend.stats.total_in_group - 1 : nPeers;
  return `${n} Benchmark Peers`;
}

function generateLandingCallout(
  metrics: { currentRank: number; rankChange: number } | null,
  peerStats: TrendStats | null,
  insight: StrategicInsight | null,
  nYears: number,
  customPeerMode: boolean,
  peerLabel: string
): string | null {
  const signals: [number, string][] = [];

  if (peerStats) {
    const cagr = peerStats.target_cagr;
    const pavg = peerStats.peer_avg_cagr;
    const diff = Math.round((cagr - pavg) * 10) / 10;

    if (!customPeerMode && peerStats.growth_rank && peerStats.total_in_group) {
      const rank = peerStats.growth_rank;
      const total = peerStats.total_in_group;
      if (rank <= 3) {
        signals.push([3, `You rank #${rank} of ${total} among your ${peerLabel} in ${nYears}-year R&D growth (${cagr}% CAGR). See who you're outpacing in Peer Analysis below.`]);
      } else if (rank > total - 3) {
        signals.push([3, `Your ${nYears}-year growth (${cagr}% CAGR) ranks #${rank} of ${total} ${peerLabel} — peer average is ${pavg}%. Peer Analysis below shows which funding sources peers are scaling faster.`]);
      } else if (diff >= 2) {
        signals.push([2, `Growing +${diff}pp faster than your ${peerLabel} (${cagr}% vs ${pavg}% CAGR over ${nYears} years). You rank #${rank} of ${total} in your peer group.`]);
      } else if (diff <= -2) {
        signals.push([2, `Growing ${Math.abs(diff)}pp slower than your ${peerLabel} (${cagr}% vs ${pavg}% CAGR over ${nYears} years). You rank #${rank} of ${total} in your peer group.`]);
      }
    } else if (diff >= 2) {
      signals.push([2, `Growing +${diff}pp faster than your ${peerLabel} (${cagr}% vs ${pavg}% CAGR over ${nYears} years).`]);
    } else if (diff <= -2) {
      signals.push([2, `Growing ${Math.abs(diff)}pp slower than your ${peerLabel} (${cagr}% vs ${pavg}% CAGR over ${nYears} years).`]);
    }
  }

  if (metrics && Math.abs(metrics.rankChange) >= 10) {
    if (metrics.rankChange > 0) {
      signals.push([2, `Rose ${metrics.rankChange} positions nationally over ${nYears} years (#${metrics.currentRank} today). See the full ranking trend above.`]);
    } else {
      signals.push([2, `National rank moved ${Math.abs(metrics.rankChange)} positions over ${nYears} years (#${metrics.currentRank} today). Peer Analysis below shows where peers gained ground.`]);
    }
  }

  if (insight?.top_field && insight?.top_field_pct != null) {
    signals.push([1, `${insight.top_field} is your largest research field at ${insight.top_field_pct}% of portfolio. See sub-field momentum in the Research Portfolio tab.`]);
  }

  if (!signals.length) return null;
  signals.sort((a, b) => b[0] - a[0]);
  return signals[0][1];
}

function PeerAnalysisSubTabs({
  gap, peerTrend, movement, growthView, setGrowthView, customPeerMode, institutionName,
}: {
  gap: GapResponse;
  peerTrend: PeerTrendResponse | null;
  movement: PeerMovementResponse | null;
  growthView: "summary" | "detail";
  setGrowthView: (v: "summary" | "detail") => void;
  customPeerMode: boolean;
  institutionName: string;
}) {
  const [subTab, setSubTab] = useState<"profile" | "growth" | "movement">("profile");

  const gapData = gap.gaps.map((g) => ({ ...g, label: METRIC_LABELS[g.metric] ?? g.metric }));

  const peerRows = peerTrend
    ? Array.from(new Map(peerTrend.trend.filter((t) => !t.is_target).map((t) => [t.inst_id, t])).values())
        .sort((a, b) => b.year - a.year)
    : [];
  // one row per peer, latest year available
  const latestPerPeer = new Map<string, typeof peerRows[number]>();
  peerRows.forEach((r) => {
    if (!latestPerPeer.has(r.inst_id) || r.year > latestPerPeer.get(r.inst_id)!.year) latestPerPeer.set(r.inst_id, r);
  });
  const peerTable = Array.from(latestPerPeer.values());

  const years = peerTrend ? Array.from(new Set(peerTrend.trend.map((t) => t.year))).sort((a, b) => a - b) : [];
  const targetName = peerTrend?.trend.find((t) => t.is_target)?.name ?? institutionName;

  const summaryData = years.map((year) => {
    const rowsThisYear = peerTrend!.trend.filter((t) => t.year === year);
    const target = rowsThisYear.find((t) => t.is_target);
    const peers = rowsThisYear.filter((t) => !t.is_target).map((t) => t.total_rd);
    const min = peers.length ? Math.min(...peers) : undefined;
    const max = peers.length ? Math.max(...peers) : undefined;
    const avg = peers.length ? peers.reduce((a, b) => a + b, 0) / peers.length : undefined;
    return { year, target: target?.total_rd, peerRange: min !== undefined && max !== undefined ? [min, max] : undefined, peerAvg: avg };
  });

  const peerNames = peerTrend ? Array.from(new Set(peerTrend.trend.filter((t) => !t.is_target).map((t) => t.name))) : [];
  const detailData = years.map((year) => {
    const row: Record<string, number | string> = { year };
    const rowsThisYear = peerTrend!.trend.filter((t) => t.year === year);
    rowsThisYear.forEach((t) => {
      row[t.is_target ? "target" : t.name] = t.total_rd;
    });
    return row;
  });

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(["profile", "growth", "movement"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              subTab === t ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "profile" ? "Funding Profile" : t === "growth" ? "Growth Over Time" : "Peer Movement"}
          </button>
        ))}
      </div>

      {subTab === "profile" && (
        <div>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={gapData} layout="vertical" margin={{ left: 10, right: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tickFormatter={(v) => formatDollars(v)} tick={{ fontSize: 12, fill: "#64748b" }} />
              <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12, fill: "#374151" }} />
              <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
              <Legend />
              <Bar dataKey="my_val" name={institutionName.split(",")[0]} fill="#2563eb" radius={[0, 4, 4, 0]} />
              <Bar dataKey="peer_avg" name="Peer Average" fill="#d1d5db" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-600">Detailed gap numbers</summary>
            <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium text-slate-500">Metric</th>
                    <th className="px-3 py-1.5 text-right font-medium text-slate-500">You</th>
                    <th className="px-3 py-1.5 text-right font-medium text-slate-500">Peer Avg</th>
                    <th className="px-3 py-1.5 text-right font-medium text-slate-500">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gapData.map((g) => (
                    <tr key={g.metric}>
                      <td className="px-3 py-1.5">{g.label}</td>
                      <td className="px-3 py-1.5 text-right">{formatDollarsFull(g.my_val)}</td>
                      <td className="px-3 py-1.5 text-right">{formatDollarsFull(g.peer_avg)}</td>
                      <td className="px-3 py-1.5 text-right">{g.gap >= 0 ? "+" : ""}{formatDollarsFull(Math.abs(g.gap))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <PeerListExpander peerTable={peerTable} customPeerMode={customPeerMode} />
        </div>
      )}

      {subTab === "growth" && (
        <div>
          <div className="mb-3 flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-1 text-xs">
            <button
              onClick={() => setGrowthView("summary")}
              className={`rounded px-3 py-1.5 font-medium ${growthView === "summary" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
            >
              Summary (peer band)
            </button>
            <button
              onClick={() => setGrowthView("detail")}
              className={`rounded px-3 py-1.5 font-medium ${growthView === "detail" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
            >
              Detail (individual peers)
            </button>
          </div>

          {!peerTrend || years.length === 0 ? (
            <p className="text-sm text-slate-500">Historical trend data is not available.</p>
          ) : growthView === "summary" ? (
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={summaryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tickFormatter={(v) => formatDollars(v)} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? `${formatDollars(v[0])} – ${formatDollars(v[1])}` : formatDollars(Number(v)))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
                <Legend />
                <Area type="monotone" dataKey="peerRange" name="Peer Range (min–max)" stroke="none" fill="#9ca3af" fillOpacity={0.15} isAnimationActive={false} legendType="none" />
                <Line type="monotone" dataKey="peerAvg" name="Peer Average" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="target" name={targetName.split(",")[0]} stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={detailData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tickFormatter={(v) => formatDollars(Number(v))} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip formatter={(v) => formatDollars(Number(v))} contentStyle={{ borderRadius: 8, borderColor: "#e2e8f0" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="target" name={targetName.split(",")[0]} stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
                {peerNames.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} name={name.split(",")[0]} stroke={COLORS[i % COLORS.length]} strokeWidth={1.25} strokeDasharray="2 3" dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}

          <PeerListExpander peerTable={peerTable} customPeerMode={customPeerMode} />
        </div>
      )}

      {subTab === "movement" && (
        <div>
          {!movement || movement.peers.length === 0 ? (
            <p className="text-sm text-slate-500">Movement data is not available for this window.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500">
                Rank and R&D growth for each peer over FY{movement.start}–FY{movement.end}.
                Peers sorted by convergence (closing the gap on you) then proximity.
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Institution</th>
                      <th className="px-3 py-2 text-right font-medium">Rank ({movement.start}→{movement.end})</th>
                      <th className="px-3 py-2 text-right font-medium">CAGR</th>
                      <th className="px-3 py-2 text-right font-medium">Total R&D ({movement.end})</th>
                      <th className="px-3 py-2 text-right font-medium">Gap vs You</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movement.peers.map((p) => {
                      const rankImproved = p.rank_delta !== null && p.rank_delta < 0;
                      const behind = p.dollar_gap !== null && p.dollar_gap < 0;
                      return (
                        <tr key={p.inst_id} className={p.is_converging ? "bg-amber-50" : ""}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{p.name}</span>
                            {p.is_converging && (
                              <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">converging</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {p.rank_start != null && p.rank_end != null ? (
                              <span>
                                #{p.rank_start} → #{p.rank_end}{" "}
                                <span className={rankImproved ? "text-green-600" : "text-red-500"}>
                                  ({rankImproved ? "+" : ""}{p.rank_delta !== null ? -p.rank_delta : "—"})
                                </span>
                              </span>
                            ) : "—"}
                          </td>
                          <td className={`px-3 py-2 text-right ${p.cagr_pct !== null && p.cagr_pct > (movement.target.cagr_pct ?? 0) ? "font-semibold text-amber-700" : ""}`}>
                            {p.cagr_pct !== null ? `${p.cagr_pct}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">{formatDollars(p.total_rd_end)}</td>
                          <td className={`px-3 py-2 text-right ${behind ? "text-slate-500" : "text-slate-800 font-medium"}`}>
                            {p.dollar_gap !== null
                              ? behind
                                ? `${formatDollars(Math.abs(p.dollar_gap))} behind`
                                : `${formatDollars(p.dollar_gap)} ahead`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {movement.target.cagr_pct !== null && (
                <p className="mt-2 text-xs text-slate-400">
                  Your {movement.end - movement.start}-year CAGR: {movement.target.cagr_pct}%.
                  Peers with higher CAGR (amber) are growing faster than you over this window.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PeerListExpander({
  peerTable, customPeerMode,
}: {
  peerTable: { inst_id: string; name: string; total_rd: number }[];
  customPeerMode: boolean;
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-slate-600">
        Who are my {peerTable.length} peers? ({customPeerMode ? "custom" : "Benchmark"})
      </summary>
      <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium text-slate-500">Institution</th>
              <th className="px-3 py-1.5 text-right font-medium text-slate-500">Total R&D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {peerTable.map((p) => (
              <tr key={p.inst_id}>
                <td className="px-3 py-1.5">{p.name}</td>
                <td className="px-3 py-1.5 text-right">{formatDollarsFull(p.total_rd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        {customPeerMode
          ? "This is your manually selected peer set. Use Custom peer selection above to modify it."
          : "Peers are identified relative to your institution's funding profile and may differ when viewed from another institution's perspective."}
      </p>
    </details>
  );
}
