"use client";

import { useEffect, useState } from "react";
import { getClassificationOptions } from "@/lib/api";
import type { PeerFilters, ClassificationOptions, CandidatePoolSize } from "@/lib/types";

interface Props {
  filters: PeerFilters;
  onApply: (filters: PeerFilters) => void;
  poolSize?: CandidatePoolSize;
}

export default function PeerFilterPanel({ filters, onApply, poolSize }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [options, setOptions] = useState<ClassificationOptions | null>(null);
  const [draft, setDraft] = useState<PeerFilters>(filters);

  useEffect(() => {
    getClassificationOptions().then(setOptions).catch(() => null);
  }, []);

  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  const hasActiveFilters =
    (filters.carnegie && filters.carnegie.length > 0) ||
    filters.control ||
    filters.exclude_med ||
    filters.aau_only ||
    filters.aplu_only ||
    filters.hbcu_only ||
    filters.hsi_only ||
    filters.epscor_only;

  const handleReset = () => {
    const empty: PeerFilters = {};
    setDraft(empty);
    onApply(empty);
  };

  const handleApply = () => {
    onApply(draft);
  };

  const toggleCarnegie = (cls: string) => {
    const current = draft.carnegie || [];
    const next = current.includes(cls)
      ? current.filter((c) => c !== cls)
      : [...current, cls];
    setDraft({ ...draft, carnegie: next.length > 0 ? next : undefined });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Refine Peer Pool
          {hasActiveFilters && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
              Filtered
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          {poolSize && (
            <span className="text-xs text-gray-500">
              {poolSize.filtered} of {poolSize.total} institutions
            </span>
          )}
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-4 space-y-4">
          {/* Carnegie Class */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Carnegie Classification</label>
            <div className="flex flex-wrap gap-2">
              {(options?.carnegie_classes || ["R1", "R2", "D/PU"]).map((cls) => (
                <button
                  key={cls}
                  onClick={() => toggleCarnegie(cls)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    (draft.carnegie || []).includes(cls)
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>

          {/* Control */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Institutional Control</label>
            <div className="flex gap-2">
              {["Public", "Private"].map((ctrl) => (
                <button
                  key={ctrl}
                  onClick={() => setDraft({ ...draft, control: draft.control === ctrl ? undefined : ctrl })}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    draft.control === ctrl
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {ctrl}
                </button>
              ))}
            </div>
          </div>

          {/* Exclude Medical */}
          <div>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.exclude_med || false}
                onChange={(e) => setDraft({ ...draft, exclude_med: e.target.checked || undefined })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Exclude medical-heavy institutions</span>
              {options && (
                <span className="text-gray-400">({options.counts.med_school} institutions)</span>
              )}
            </label>
          </div>

          {/* Membership checkboxes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Membership Filters</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {([
                { key: "aau_only", label: "AAU only", count: options?.counts.aau },
                { key: "aplu_only", label: "APLU only", count: options?.counts.aplu },
                { key: "hbcu_only", label: "HBCU only", count: options?.counts.hbcu },
                { key: "hsi_only", label: "HSI only", count: options?.counts.hsi },
                { key: "epscor_only", label: "EPSCoR only", count: options?.counts.epscor },
              ] as const).map(({ key, label, count }) => (
                <label key={key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(draft[key] as boolean) || false}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.checked || undefined })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{label}</span>
                  {count !== undefined && <span className="text-gray-400">({count})</span>}
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button
              onClick={handleReset}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Reset all filters
            </button>
            <button
              onClick={handleApply}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
