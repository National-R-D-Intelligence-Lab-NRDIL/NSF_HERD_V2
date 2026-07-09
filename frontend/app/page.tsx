"use client";

import { useState } from "react";
import InstitutionPicker from "@/components/InstitutionPicker";
import CustomPeerSelector from "@/components/CustomPeerSelector";
import SnapshotTab from "@/components/SnapshotTab";
import PortfolioTab from "@/components/PortfolioTab";
import FederalTab from "@/components/FederalTab";
import QaTab from "@/components/QaTab";
import type { InstitutionListItem } from "@/lib/types";

const MAX_YEAR = 2024;
const TABS = ["Institution Snapshot", "Research Portfolio", "Federal Landscape", "Ask a Question"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [selected, setSelected] = useState<InstitutionListItem | null>(null);
  const [timeWindow, setTimeWindow] = useState<5 | 10>(5);
  const [activeTab, setActiveTab] = useState<Tab>("Institution Snapshot");
  const [customPeerIds, setCustomPeerIds] = useState<string[]>([]);

  const startYear = MAX_YEAR - timeWindow;
  const endYear = MAX_YEAR;

  const handleSelect = (inst: InstitutionListItem) => {
    setSelected(inst);
    setCustomPeerIds([]);
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
              <p className="text-xs text-slate-500">University R&amp;D funding intelligence, FY2010–FY2024</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Pick an institution</label>
            <InstitutionPicker year={MAX_YEAR} selectedInstId={selected?.inst_id ?? null} onSelect={handleSelect} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Time window</label>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
              value={timeWindow}
              onChange={(e) => setTimeWindow(Number(e.target.value) as 5 | 10)}
            >
              <option value={5}>5-Year ({MAX_YEAR - 5}–{MAX_YEAR})</option>
              <option value={10}>10-Year ({MAX_YEAR - 10}–{MAX_YEAR})</option>
            </select>
          </div>
        </div>

        {selected && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <CustomPeerSelector
              year={MAX_YEAR}
              excludeInstId={selected.inst_id}
              appliedPeerIds={customPeerIds}
              onApply={setCustomPeerIds}
              onClear={() => setCustomPeerIds([])}
            />
          </div>
        )}

        {!selected ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-sm text-slate-500">Select an institution above to get started.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
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

            {activeTab === "Institution Snapshot" && (
              <SnapshotTab
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
              />
            )}
            {activeTab === "Research Portfolio" && (
              <PortfolioTab
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
              />
            )}
            {activeTab === "Federal Landscape" && (
              <FederalTab
                instId={selected.inst_id}
                startYear={startYear}
                endYear={endYear}
                customPeerIds={customPeerIds}
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
