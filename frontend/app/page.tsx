"use client";

import { useEffect, useState } from "react";
import InstitutionPicker from "@/components/InstitutionPicker";
import CustomPeerSelector from "@/components/CustomPeerSelector";
import PeerFilterPanel from "@/components/PeerFilterPanel";
import BriefingButton from "@/components/BriefingButton";
import SnapshotTab from "@/components/SnapshotTab";
import PortfolioTab from "@/components/PortfolioTab";
import FederalTab from "@/components/FederalTab";
import QaTab from "@/components/QaTab";
import { getPeers } from "@/lib/api";
import type { InstitutionListItem, PeerFilters, CandidatePoolSize } from "@/lib/types";

const MAX_YEAR = 2024;
const MIN_YEAR = 2010;
const N_PEERS = 10;
const VIEW_YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MAX_YEAR - i);
const TABS = ["Institution Snapshot", "Research Portfolio", "Federal Landscape", "Ask a Question"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [selected, setSelected] = useState<InstitutionListItem | null>(null);
  const [viewYear, setViewYear] = useState(MAX_YEAR);
  const [timeWindow, setTimeWindow] = useState<5 | 10>(5);
  const [activeTab, setActiveTab] = useState<Tab>("Institution Snapshot");
  const [customPeerIds, setCustomPeerIds] = useState<string[]>([]);
  const [peerFilters, setPeerFilters] = useState<PeerFilters>({});
  const [poolSize, setPoolSize] = useState<CandidatePoolSize | undefined>(undefined);

  const customPeerMode = customPeerIds.length > 0;
  const endYear = viewYear;
  const startYear = Math.max(MIN_YEAR, viewYear - timeWindow);

  useEffect(() => {
    if (!selected) {
      setPoolSize(undefined);
      return;
    }
    getPeers(selected.inst_id, { n: N_PEERS, filters: peerFilters })
      .then((r) => setPoolSize(r.candidate_pool_size))
      .catch(() => setPoolSize(undefined));
  }, [selected, peerFilters]);

  const handleSelect = (inst: InstitutionListItem) => {
    setSelected(inst);
    setCustomPeerIds([]);
    setPeerFilters({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1.5 rounded-full bg-blue-600" />
            <div>
              <h1 className="text-lg font-bold leading-tight text-slate-900">NSF HERD Research Intelligence</h1>
              <p className="text-xs text-slate-500">
                University R&amp;D funding intelligence, FY{MIN_YEAR}–FY{MAX_YEAR}
                {" · "}
                {viewYear === MAX_YEAR
                  ? `Viewing the latest available year (FY${MAX_YEAR}).`
                  : `Viewing FY${viewYear} — the latest available year is FY${MAX_YEAR}.`}
                {" "}NSF publishes HERD survey data on roughly an 18-month lag.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Pick an institution</label>
            <InstitutionPicker year={viewYear} selectedInstId={selected?.inst_id ?? null} onSelect={handleSelect} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Snapshot year</label>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              value={viewYear}
              onChange={(e) => setViewYear(Number(e.target.value))}
            >
              {VIEW_YEARS.map((y) => (
                <option key={y} value={y}>
                  FY{y}{y === MAX_YEAR ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Growth window</label>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              value={timeWindow}
              onChange={(e) => setTimeWindow(Number(e.target.value) as 5 | 10)}
            >
              <option value={5}>5-Year ({Math.max(MIN_YEAR, endYear - 5)}–{endYear})</option>
              <option value={10}>10-Year ({Math.max(MIN_YEAR, endYear - 10)}–{endYear})</option>
            </select>
          </div>
        </div>

        {selected && (
          <div className="mb-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <details className="rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">
              <summary className="cursor-pointer select-none px-3 py-2 font-medium text-slate-700">
                How is my peer set chosen?
              </summary>
              <p className="border-t border-slate-200 px-3 py-2">
                By default, we match {N_PEERS} institutions nationally using a K-nearest-neighbors algorithm across
                total R&amp;D, funding mix, and field profile. Use the options below to select your own peer
                institutions, or narrow the matched pool by Carnegie class, control, or membership (AAU, HBCU, etc.).
              </p>
            </details>

            <CustomPeerSelector
              year={viewYear}
              excludeInstId={selected.inst_id}
              appliedPeerIds={customPeerIds}
              onApply={setCustomPeerIds}
              onClear={() => setCustomPeerIds([])}
            />

            {!customPeerMode && (
              <PeerFilterPanel filters={peerFilters} onApply={setPeerFilters} poolSize={poolSize} />
            )}
          </div>
        )}

        {!selected ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-sm text-slate-500">Select an institution above to get started.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <BriefingButton
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
              />
            </div>

            {activeTab === "Institution Snapshot" && (
              <SnapshotTab
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
                peerFilters={peerFilters}
              />
            )}
            {activeTab === "Research Portfolio" && (
              <PortfolioTab
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
                peerFilters={peerFilters}
              />
            )}
            {activeTab === "Federal Landscape" && (
              <FederalTab
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
                peerFilters={peerFilters}
              />
            )}
            {activeTab === "Ask a Question" && (
              <QaTab
                instId={selected.inst_id}
                institutionName={selected.name}
                state={selected.state}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
