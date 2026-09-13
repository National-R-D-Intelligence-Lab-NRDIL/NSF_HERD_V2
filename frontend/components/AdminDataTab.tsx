"use client";

import { useEffect, useState } from "react";
import { getDataStatus } from "@/lib/api";
import type { DataStatusResponse } from "@/lib/types";

function formatDate(value: string | null) {
  if (!value) return "Unknown (pre-tracking)";
  return new Date(value).toLocaleString();
}

const COUNT_COLUMNS: { key: string; label: string }[] = [
  { key: "raw_institutions", label: "Institutions" },
  { key: "raw_field_expenditures", label: "Field expenditures" },
  { key: "raw_agency_funding", label: "Agency funding" },
];

export default function AdminDataTab() {
  const [status, setStatus] = useState<DataStatusResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDataStatus()
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!status) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div>
      <p className="mb-4 text-xs text-slate-500">
        NSF publishes HERD survey data on roughly an 18-month lag, about once a year. This reflects
        what&apos;s currently loaded in the database, not what NSF has published overall.
      </p>

      {status.gap_years.length > 0 && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Gap in loaded years: {status.gap_years.join(", ")}. Worth checking whether this is expected.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Year</th>
              <th className="px-4 py-2">Loaded</th>
              <th className="px-4 py-2">Source</th>
              {COUNT_COLUMNS.map((c) => (
                <th key={c.key} className="px-4 py-2 text-right">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {status.years.length === 0 && (
              <tr><td className="px-4 py-3 text-slate-400" colSpan={3 + COUNT_COLUMNS.length}>No data loaded yet.</td></tr>
            )}
            {status.years.map((y) => (
              <tr key={y.year} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium text-slate-900">{y.year}</td>
                <td className="px-4 py-2 text-slate-500">{formatDate(y.loaded_at)}</td>
                <td className="px-4 py-2 text-slate-500">{y.source}</td>
                {COUNT_COLUMNS.map((c) => (
                  <td key={c.key} className="px-4 py-2 text-right text-slate-700">
                    {(y.row_counts?.[c.key] ?? 0).toLocaleString()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
