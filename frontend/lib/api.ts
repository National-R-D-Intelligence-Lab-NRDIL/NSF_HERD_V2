import type {
  InstitutionListItem,
  InstitutionDetail,
  RankPoint,
  AnchorResponse,
  FundingBreakdown,
  StateRanking,
  PeersResponse,
  GapResponse,
  PeerTrendResponse,
  FieldPortfolioRow,
  FieldDrilldownRow,
  FieldMomentumRow,
  AgencyRow,
  ConcentrationResponse,
  AgencyTrendRow,
  QaResponse,
  StrategicInsight,
  FieldPeerComparisonResponse,
  AgencyPeerComparisonResponse,
  SuggestedQuestionsResponse,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json();
}

// --- institutions ---
export const listInstitutions = (params: { year?: number; state?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.year) q.set("year", String(params.year));
  if (params.state) q.set("state", params.state);
  q.set("limit", String(params.limit ?? 1000));
  return getJson<InstitutionListItem[]>(`/institutions?${q}`);
};

export const getInstitution = (instId: string, year = 2024) =>
  getJson<InstitutionDetail>(`/institutions/${instId}?year=${year}`);

export const getRankTrend = (instId: string, start = 2019, end = 2024) =>
  getJson<RankPoint[]>(`/institutions/${instId}/rank?start=${start}&end=${end}`);

export const getAnchorView = (instId: string, year = 2024) =>
  getJson<AnchorResponse>(`/institutions/${instId}/anchor?year=${year}`);

export const getFundingBreakdown = (instId: string, start = 2019, end = 2024) =>
  getJson<FundingBreakdown>(`/institutions/${instId}/funding?start=${start}&end=${end}`);

export const getStateRanking = (instId: string, year = 2024) =>
  getJson<StateRanking>(`/institutions/${instId}/state-rank?year=${year}`);

export const getStrategicInsight = (
  instId: string,
  start = 2019,
  end = 2024,
  opts: { n?: number; peerIds?: string[] } = {}
) => {
  const q = new URLSearchParams({ start: String(start), end: String(end) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  return getJson<StrategicInsight>(`/institutions/${instId}/insight?${q}`);
};

// --- peers ---
export const getPeers = (instId: string, n?: number) =>
  getJson<PeersResponse>(`/peers/${instId}${n ? `?n=${n}` : ""}`);

export const getGap = (instId: string, opts: { n?: number; peerIds?: string[] } = {}) => {
  const q = new URLSearchParams();
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  const qs = q.toString();
  return getJson<GapResponse>(`/peers/${instId}/gap${qs ? `?${qs}` : ""}`);
};

export const getPeerTrend = (
  instId: string,
  start = 2019,
  end = 2024,
  opts: { n?: number; peerIds?: string[] } = {}
) => {
  const q = new URLSearchParams({ start: String(start), end: String(end) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  return getJson<PeerTrendResponse>(`/peers/${instId}/trend?${q}`);
};

// --- portfolio ---
export const getFieldPortfolio = (instId: string, year = 2024) =>
  getJson<FieldPortfolioRow[]>(`/portfolio/${instId}?year=${year}`);

export const getFieldDrilldown = (instId: string, parentField: string, year = 2024) =>
  getJson<FieldDrilldownRow[]>(`/portfolio/${instId}/drilldown?parent_field=${parentField}&year=${year}`);

export const getFieldMomentum = (instId: string, start = 2019, end = 2024) =>
  getJson<FieldMomentumRow[]>(`/portfolio/${instId}/momentum?start=${start}&end=${end}`);

export const getFieldPeerComparison = (
  instId: string,
  year = 2024,
  opts: { n?: number; peerIds?: string[] } = {}
) => {
  const q = new URLSearchParams({ year: String(year) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  return getJson<FieldPeerComparisonResponse>(`/portfolio/${instId}/peer-comparison?${q}`);
};

// --- federal ---
export const getAgencyBreakdown = (instId: string, year = 2024) =>
  getJson<AgencyRow[]>(`/federal/${instId}?year=${year}`);

export const getAgencyTrend = (instId: string, start = 2019, end = 2024) =>
  getJson<AgencyTrendRow[]>(`/federal/${instId}/trend?start=${start}&end=${end}`);

export const getConcentration = (instId: string, year = 2024) =>
  getJson<ConcentrationResponse>(`/federal/${instId}/concentration?year=${year}`);

export const getAgencyPeerComparison = (
  instId: string,
  year = 2024,
  opts: { n?: number; peerIds?: string[] } = {}
) => {
  const q = new URLSearchParams({ year: String(year) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  return getJson<AgencyPeerComparisonResponse>(`/federal/${instId}/peer-comparison?${q}`);
};

export const getSuggestedQuestions = (
  instId: string,
  start = 2019,
  end = 2024,
  opts: { n?: number; peerIds?: string[] } = {}
) => {
  const q = new URLSearchParams({ start: String(start), end: String(end) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  return getJson<SuggestedQuestionsResponse>(`/institutions/${instId}/suggested-questions?${q}`);
};

// --- qa ---
export async function askQuestion(payload: {
  question: string;
  inst_id?: string;
  institution_name?: string;
  state?: string;
  start_year?: number;
  end_year?: number;
  peer_inst_ids?: string[];
}) {
  const res = await fetch(`${BASE_URL}/qa/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<QaResponse>;
}
