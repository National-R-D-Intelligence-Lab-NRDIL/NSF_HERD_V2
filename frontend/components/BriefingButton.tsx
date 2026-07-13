"use client";

import { useState } from "react";
import { getBriefing } from "@/lib/api";

interface Props {
  instId: string;
  startYear: number;
  endYear: number;
  customPeerIds: string[];
}

const N_PEERS = 10;

const ACCENT: [number, number, number] = [37, 99, 235]; // tailwind blue-600
const ACCENT_BG: [number, number, number] = [239, 246, 255]; // tailwind blue-50
const ACCENT_TEXT: [number, number, number] = [30, 58, 138]; // tailwind blue-900

// jsPDF is lazy-loaded (dynamic import) so it's only pulled into the
// bundle when a user actually clicks "Generate Briefing" -- keeps it
// out of the initial page load entirely.
async function renderPdf(briefing: Awaited<ReturnType<typeof getBriefing>>) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 56;
  const fullWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = fullWidth - marginX * 2;
  const bottomLimit = pageHeight - 56;
  const topMargin = 56;

  let y = 0;

  // Pushes to a new page (resetting y to the top margin) if the next
  // block of content wouldn't fit above the footer.
  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = topMargin;
    }
  };

  const drawAccentBar = () => {
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, fullWidth, 6, "F");
  };
  drawAccentBar();
  y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("Research Positioning Brief", marginX, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${briefing.institution_name} \u00b7 FY${briefing.year}`, marginX, y);
  y += 24;

  // --- Headline callout box ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  const headlineLines = doc.splitTextToSize(briefing.headline, pageWidth - 24);
  const headlineBoxHeight = headlineLines.length * 16 + 20;
  ensureSpace(headlineBoxHeight + 14);
  doc.setFillColor(...ACCENT_BG);
  doc.setDrawColor(...ACCENT);
  doc.roundedRect(marginX, y, pageWidth, headlineBoxHeight, 4, 4, "FD");
  doc.setTextColor(...ACCENT_TEXT);
  doc.text(headlineLines, marginX + 12, y + 20);
  y += headlineBoxHeight + 22;

  // --- Key metrics grid (2 columns) ---
  if (briefing.key_metrics.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30);
    ensureSpace(20);
    doc.text("Key Metrics", marginX, y);
    y += 14;

    const colWidth = pageWidth / 2;
    const rowHeight = 32;
    const metrics = briefing.key_metrics;
    const numRows = Math.ceil(metrics.length / 2);
    ensureSpace(numRows * rowHeight + 10);
    const tableTop = y;
    for (let i = 0; i < metrics.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = marginX + col * colWidth;
      const cy = tableTop + row * rowHeight;
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(cx, cy, colWidth - 8, rowHeight - 6, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(metrics[i].label.toUpperCase(), cx + 8, cy + 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(20);
      const valueLines = doc.splitTextToSize(metrics[i].value, colWidth - 24);
      doc.text(valueLines[0], cx + 8, cy + 24);
    }
    y = tableTop + numRows * rowHeight + 20;
  }

  // --- Peer comparison table ---
  if (briefing.peer_table.length) {
    ensureSpace(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text("Peer Comparison", marginX, y);
    y += 16;

    const col1 = marginX; // rank
    const col2 = marginX + 50; // institution
    const col3 = marginX + pageWidth - 110; // total R&D

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("RANK", col1, y);
    doc.text("INSTITUTION", col2, y);
    doc.text("TOTAL R&D", col3, y);
    y += 6;
    doc.setDrawColor(220);
    doc.line(marginX, y, marginX + pageWidth, y);
    y += 14;

    for (const row of briefing.peer_table) {
      ensureSpace(18);
      if (row.is_target) {
        doc.setFillColor(...ACCENT_BG);
        doc.rect(marginX - 4, y - 10, pageWidth + 8, 16, "F");
      }
      doc.setFont("helvetica", row.is_target ? "bold" : "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(row.is_target ? 30 : 60);
      doc.text(`#${row.rank}`, col1, y);
      const nameLines = doc.splitTextToSize(row.name, col3 - col2 - 10);
      doc.text(nameLines[0], col2, y);
      doc.text(`$${row.total_rd.toLocaleString()}`, col3, y);
      y += 16;
    }
    y += 10;
  }

  // --- Total R&D trend chart (hand-drawn, no charting library) ---
  if (briefing.rank_trend.length > 1) {
    const chartHeight = 90;
    ensureSpace(chartHeight + 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text("Total R&D Trend", marginX, y);
    y += 16;

    const chartTop = y;
    const chartBottom = chartTop + chartHeight;
    const points = briefing.rank_trend;
    const values = points.map((p) => p.total_rd);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const stepX = pageWidth / (points.length - 1);

    doc.setDrawColor(210);
    doc.line(marginX, chartBottom, marginX + pageWidth, chartBottom);

    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(1.5);
    for (let i = 0; i < points.length - 1; i++) {
      const x1 = marginX + i * stepX;
      const y1 = chartBottom - ((values[i] - minVal) / range) * chartHeight;
      const x2 = marginX + (i + 1) * stepX;
      const y2 = chartBottom - ((values[i + 1] - minVal) / range) * chartHeight;
      doc.line(x1, y1, x2, y2);
    }
    doc.setLineWidth(1);
    doc.setDrawColor(0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100);
    points.forEach((p, i) => {
      if (i === 0 || i === points.length - 1 || i % 2 === 0) {
        const x = marginX + i * stepX;
        doc.text(String(p.year), x - 8, chartBottom + 12);
      }
    });

    y = chartBottom + 28;
  }

  // --- Narrative sections ---
  for (const section of briefing.sections) {
    if (!section.body) continue;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const bodyLines = doc.splitTextToSize(section.body, pageWidth);
    ensureSpace(15 + bodyLines.length * 14 + 16);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text(section.title, marginX, y);
    y += 15;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(50);
    doc.text(bodyLines, marginX, y);
    y += bodyLines.length * 14 + 16;
  }

  // --- Footnote ---
  const footnoteLines = doc.splitTextToSize(briefing.footnote, pageWidth);
  ensureSpace(footnoteLines.length * 11 + 24);
  y += 8;
  doc.setDrawColor(230);
  doc.line(marginX, y, marginX + pageWidth, y);
  y += 16;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(120);
  doc.text(footnoteLines, marginX, y);

  // --- Footer (generated date + page number) on every page ---
  const pageCount = doc.getNumberOfPages();
  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Generated ${generatedDate}`, marginX, pageHeight - 28);
    doc.text(`Page ${p} of ${pageCount}`, marginX + pageWidth - 70, pageHeight - 28);
  }

  const fileName = `${briefing.institution_name.replace(/[^a-z0-9]+/gi, "_")}_FY${briefing.year}_briefing.pdf`;
  doc.save(fileName);
}

export default function BriefingButton({ instId, startYear, endYear, customPeerIds }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const briefing = await getBriefing(instId, startYear, endYear, {
        n: customPeerIds.length ? undefined : N_PEERS,
        peerIds: customPeerIds.length ? customPeerIds : undefined,
      });
      await renderPdf(briefing);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Generating…" : "Generate Briefing"}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
