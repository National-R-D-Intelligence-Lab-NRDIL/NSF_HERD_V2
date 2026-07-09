"use client";

import { useEffect, useRef, useState } from "react";
import { listInstitutions } from "@/lib/api";
import type { InstitutionListItem } from "@/lib/types";

interface Props {
  year: number;
  selectedInstId: string | null;
  onSelect: (inst: InstitutionListItem) => void;
}

export default function InstitutionPicker({ year, selectedInstId, onSelect }: Props) {
  const [institutions, setInstitutions] = useState<InstitutionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    listInstitutions({ year, limit: 1000 })
      .then((rows) => {
        setInstitutions([...rows].sort((a, b) => a.name.localeCompare(b.name)));
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = institutions.find((i) => i.inst_id === selectedInstId) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? institutions.filter(
        (i) => i.name.toLowerCase().includes(q) || i.state.toLowerCase() === q
      )
    : institutions;
  const results = filtered.slice(0, 50);

  if (error) return <p className="text-sm text-red-600">Failed to load institutions: {error}</p>;

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        disabled={loading}
        placeholder={loading ? "Loading institutions…" : "Type to search institutions…"}
        className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
        value={open ? query : selected?.name ?? query}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const inst = results[highlight];
            if (inst) {
              onSelect(inst);
              setOpen(false);
              setQuery("");
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full max-w-md overflow-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {results.length === 0 && (
            <li className="px-3 py-2 text-slate-400">No institutions match &ldquo;{query}&rdquo;</li>
          )}
          {results.map((inst, i) => (
            <li
              key={inst.inst_id}
              onMouseDown={() => {
                onSelect(inst);
                setOpen(false);
                setQuery("");
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-2 ${
                i === highlight ? "bg-blue-50 text-blue-900" : "text-slate-700"
              } ${inst.inst_id === selectedInstId ? "font-semibold" : ""}`}
            >
              {inst.name} <span className="text-slate-400">({inst.state})</span>
            </li>
          ))}
          {filtered.length > results.length && (
            <li className="px-3 py-1.5 text-xs text-slate-400">
              {filtered.length - results.length} more — keep typing to narrow down
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
