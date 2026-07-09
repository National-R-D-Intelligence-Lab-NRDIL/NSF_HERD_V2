"use client";

import { useEffect, useState } from "react";
import { askQuestion, getSuggestedQuestions } from "@/lib/api";
import type { QaResponse, SuggestedQuestionGroup } from "@/lib/types";
import Card from "./Card";

interface Props {
  instId: string | null;
  institutionName: string | null;
  state: string | null;
  startYear: number;
  endYear: number;
  customPeerIds: string[];
}

interface HistoryEntry {
  question: string;
  response?: QaResponse;
  error?: string;
}

const N_PEERS = 10;

export default function QaTab({ instId, institutionName, state, startYear, endYear, customPeerIds }: Props) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedQuestionGroup[]>([]);

  useEffect(() => {
    setHistory([]);
    setSuggestions([]);
    if (!instId) return;
    const peerOpts = customPeerIds.length > 0 ? { peerIds: customPeerIds } : { n: N_PEERS };
    getSuggestedQuestions(instId, startYear, endYear, peerOpts)
      .then((r) => setSuggestions(r.groups))
      .catch(() => setSuggestions([]));
  }, [instId, startYear, endYear, customPeerIds]);

  const submit = async (q: string) => {
    if (!q.trim() || loading) return;
    setLoading(true);
    setQuestion("");
    const entry: HistoryEntry = { question: q };
    setHistory((h) => [...h, entry]);
    try {
      const response = await askQuestion({
        question: q,
        inst_id: instId ?? undefined,
        institution_name: institutionName ?? undefined,
        state: state ?? undefined,
        start_year: startYear,
        end_year: endYear,
      });
      setHistory((h) => h.map((e) => (e === entry ? { ...e, response } : e)));
    } catch (e) {
      setHistory((h) => h.map((e) => (e === entry ? { ...e, error: String(e) } : e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <p className="text-xs text-slate-500">
        Ask a natural-language question about R&D funding. The current institution, state, and
        {` ${startYear}–${endYear}`} time window are passed as context automatically.
      </p>

      {history.length === 0 && suggestions.length > 0 && (
        <div className="mt-3 space-y-3">
          {suggestions.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-xs font-medium text-slate-500">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.questions.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {history.map((entry, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="font-medium text-slate-900">{entry.question}</p>
            {!entry.response && !entry.error && (
              <p className="mt-2 text-sm text-slate-400">Thinking…</p>
            )}
            {entry.error && <p className="mt-2 text-sm text-red-600">{entry.error}</p>}
            {entry.response && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-slate-800">{entry.response.summary}</p>
                {entry.response.results.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500">
                      {entry.response.results.length} row{entry.response.results.length === 1 ? "" : "s"} · view data
                    </summary>
                    <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                      <table className="min-w-full divide-y divide-slate-100 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            {Object.keys(entry.response.results[0]).map((col) => (
                              <th key={col} className="px-2 py-1 text-left font-medium text-slate-500">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {entry.response.results.slice(0, 20).map((row, ri) => (
                            <tr key={ri}>
                              {Object.values(row).map((v, ci) => (
                                <td key={ci} className="px-2 py-1">{String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-500">View generated SQL</summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-slate-100">
                    {entry.response.sql}
                  </pre>
                </details>
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about university R&D funding…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>
    </Card>
  );
}
