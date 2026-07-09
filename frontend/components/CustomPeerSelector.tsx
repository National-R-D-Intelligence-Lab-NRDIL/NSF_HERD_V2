"use client";

import { useEffect, useRef, useState } from "react";
import { listInstitutions } from "@/lib/api";
import type { InstitutionListItem } from "@/lib/types";

interface Props {
  year: number;
  excludeInstId: string;
  appliedPeerIds: string[];
  onApply: (peerInstIds: string[]) => void;
  onClear: () => void;
}

/**
 * Ported from v1's custom peer multiselect: staged selection (doesn't take
 * effect until "Apply") so switching peer sets doesn't refire every chart
 * on every checkbox click.
 */
export default function CustomPeerSelector({
  year,
  excludeInstId,
  appliedPeerIds,
  onApply,
  onClear,
}: Props) {
  const [institutions, setInstitutions] = useState<InstitutionListItem[]>([]);
  const [pending, setPending] = useState<string[]>(appliedPeerIds);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listInstitutions({ year, limit: 1000 }).then((rows) =>
      setInstitutions([...rows].sort((a, b) => a.name.localeCompare(b.name)))
    );
  }, [year]);

  useEffect(() => setPending(appliedPeerIds), [appliedPeerIds]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const options = institutions.filter((i) => i.inst_id !== excludeInstId);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((i) => i.name.toLowerCase().includes(q)) : options;

  const toggle = (instId: string) => {
    setPending((p) => (p.includes(instId) ? p.filter((id) => id !== instId) : [...p, instId]));
  };

  const pendingChanged = JSON.stringify([...pending].sort()) !== JSON.stringify([...appliedPeerIds].sort());

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-500">
        Custom peer selection <span className="font-normal text-slate-400">(overrides the AI-matched benchmark peers)</span>
      </label>
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full max-w-md flex-wrap items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-left text-sm shadow-sm focus:border-blue-500 focus:outline-none"
        >
          {pending.length === 0 && <span className="text-slate-400">Select institutions…</span>}
          {pending.map((id) => {
            const inst = institutions.find((i) => i.inst_id === id);
            if (!inst) return null;
            return (
              <span
                key={id}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(id);
                }}
                className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 hover:bg-blue-200"
              >
                {inst.name} <span className="font-bold">×</span>
              </span>
            );
          })}
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full max-w-md rounded-md border border-slate-200 bg-white shadow-lg">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search institutions…"
              className="w-full border-b border-slate-200 px-3 py-2 text-sm focus:outline-none"
            />
            <ul className="max-h-64 overflow-auto text-sm">
              {filtered.map((inst) => (
                <li
                  key={inst.inst_id}
                  onClick={() => toggle(inst.inst_id)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                >
                  <input type="checkbox" readOnly checked={pending.includes(inst.inst_id)} className="accent-blue-600" />
                  <span className="text-slate-700">
                    {inst.name} <span className="text-slate-400">({inst.state})</span>
                  </span>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-3 py-2 text-slate-400">No matches</li>}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!pendingChanged || pending.length === 0}
          onClick={() => onApply(pending)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Apply
        </button>
        {appliedPeerIds.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setPending([]);
              onClear();
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
        )}
        {appliedPeerIds.length > 0 && (
          <span className="text-xs text-slate-500">
            📌 Custom peer mode — {appliedPeerIds.length} institution{appliedPeerIds.length === 1 ? "" : "s"} selected.
          </span>
        )}
      </div>
    </div>
  );
}
