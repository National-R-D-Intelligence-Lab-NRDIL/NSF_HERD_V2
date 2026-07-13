"use client";

import { useEffect, useState } from "react";
import { getInstitution } from "@/lib/api";
import type { InstitutionDetail } from "@/lib/types";
import { formatDollars, formatRank } from "@/lib/format";
import Card from "./Card";

interface Props {
  instId: string;
  minYear: number;
  maxYear: number;
}

interface Row {
  label: string;
  a: string;
  b: string;
  delta: number;
  deltaLabel: string;
  improved: boolean;
}

export default function YearCompare({ instId, minYear, maxYear }: Props) {
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);
  const [yearA, setYearA] = useState(Math.max(minYear, maxYear - 5));
  const [yearB, setYearB] = useState(maxYear);
  const [detailA, setDetailA] = useState<InstitutionDetail | null>(null);
  const [detailB, setDetailB] = useState<InstitutionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setDetailA(null);
    setDetailB(null);
    Promise.all([getInstitution(instId, yearA), getInstitution(instId, yearB)])
      .then(([a, b]) => {
        setDetailA(a);
        setDetailB(b);
      })
      .catch((e) => setError(String(e)));
  }, [instId, yearA, yearB]);

  const rows: Row[] =
    detailA && detailB
      ? [
          {
            label: "National Rank",
            a: formatRank(detailA.national_rank),
            b: formatRank(detailB.national_rank),
            delta: detailA.national_rank - detailB.national_rank,
            deltaLabel: `${detailA.national_rank - detailB.national_rank > 0 ? "+" : ""}${detailA.national_rank - detailB.national_rank} positions`,
            improved: detailA.national_rank - detailB.national_rank > 0,
          },
          {
            label: "Total R&D",
            a: formatDollars(detailA.total_rd),
            b: formatDollars(detailB.total_rd),
            delta: detailB.total_rd - detailA.total_rd,
            deltaLabel: `${detailB.total_rd - detailA.total_rd >= 0 ? "+" : ""}${formatDollars(detailB.total_rd - detailA.total_rd)}`,
            improved: detailB.total_rd - detailA.total_rd >= 0,
          },
          {
            label: "Federal Funding",
            a: formatDollars(detailA.federal),
            b: formatDollars(detailB.federal),
            delta: detailB.federal - detailA.federal,
            deltaLabel: `${detailB.federal - detailA.federal >= 0 ? "+" : ""}${formatDollars(detailB.federal - detailA.federal)}`,
            improved: detailB.federal - detailA.federal >= 0,
          },
        ]
      : [];

  return (
    <Card title="Compare Two Years" caption="Pick any two years to see how key metrics changed between them.">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Year A</span>
          <select
            value={yearA}
            onChange={(e) => setYearA(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                FY{y}
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-400">vs</span>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Year B</span>
          <select
            value={yearB}
            onChange={(e) => setYearB(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                FY{y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Metric</th>
                <th className="px-3 py-2 text-right font-medium text-slate-500">FY{yearA}</th>
                <th className="px-3 py-2 text-right font-medium text-slate-500">FY{yearB}</th>
                <th className="px-3 py-2 text-right font-medium text-slate-500">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-3 py-2 text-right">{r.a}</td>
                  <td className="px-3 py-2 text-right">{r.b}</td>
                  <td className={`px-3 py-2 text-right font-medium ${r.improved ? "text-emerald-600" : "text-red-600"}`}>
                    {r.deltaLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
