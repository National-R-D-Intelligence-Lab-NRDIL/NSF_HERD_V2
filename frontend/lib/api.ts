import { supabase } from "./supabase";
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
  PeerMovementResponse,
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
  ClassificationData,
  ClassificationOptions,
  PeerFilters,
  BriefingResponse,
  AdminUser,
  DataStatusResponse,
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

async function getAuthHeaders(): Promise<HeadersInit> {
  if (!supabase) return {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    // ignore — protected endpoints will return 401 if token is missing
  }
  return {};
}

async function getJsonAuth<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}${path}`, { headers });
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
  return getJsonAuth<StrategicInsight>(`/institutions/${instId}/insight?${q}`);
};

// --- filter helpers ---
function applyPeerFilters(q: URLSearchParams, filters?: PeerFilters) {
  if (!filters) return;
  if (filters.carnegie?.length) q.set("carnegie", filters.carnegie.join(","));
  if (filters.control) q.set("control", filters.control);
  if (filters.exclude_med) q.set("exclude_med", "true");
  if (filters.aau_only) q.set("aau_only", "true");
  if (filters.aplu_only) q.set("aplu_only", "true");
  if (filters.hbcu_only) q.set("hbcu_only", "true");
  if (filters.hsi_only) q.set("hsi_only", "true");
  if (filters.epscor_only) q.set("epscor_only", "true");
}

// --- peers ---
export const getPeers = (instId: string, opts: { n?: number; filters?: PeerFilters } = {}) => {
  const q = new URLSearchParams();
  if (opts.n) q.set("n", String(opts.n));
  applyPeerFilters(q, opts.filters);
  const qs = q.toString();
  return getJson<PeersResponse>(`/peers/${instId}${qs ? `?${qs}` : ""}`);
};

export const getGap = (instId: string, opts: { n?: number; peerIds?: string[]; filters?: PeerFilters } = {}) => {
  const q = new URLSearchParams();
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  applyPeerFilters(q, opts.filters);
  const qs = q.toString();
  return getJson<GapResponse>(`/peers/${instId}/gap${qs ? `?${qs}` : ""}`);
};

export const getPeerTrend = (
  instId: string,
  start = 2019,
  end = 2024,
  opts: { n?: number; peerIds?: string[]; filters?: PeerFilters } = {}
) => {
  const q = new URLSearchParams({ start: String(start), end: String(end) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  applyPeerFilters(q, opts.filters);
  return getJson<PeerTrendResponse>(`/peers/${instId}/trend?${q}`);
};

export const getPeerMovement = (
  instId: string,
  start = 2019,
  end = 2024,
  opts: { n?: number; peerIds?: string[]; filters?: PeerFilters } = {}
) => {
  const q = new URLSearchParams({ start: String(start), end: String(end) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  applyPeerFilters(q, opts.filters);
  return getJson<PeerMovementResponse>(`/peers/${instId}/movement?${q}`);
};

// --- classifications ---
export const getClassification = (instId: string) =>
  getJson<ClassificationData>(`/classifications/${instId}`);

export const getClassificationOptions = () =>
  getJson<ClassificationOptions>(`/classifications/options`);

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
  opts: { n?: number; peerIds?: string[]; filters?: PeerFilters } = {}
) => {
  const q = new URLSearchParams({ year: String(year) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  applyPeerFilters(q, opts.filters);
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
  opts: { n?: number; peerIds?: string[]; filters?: PeerFilters } = {}
) => {
  const q = new URLSearchParams({ year: String(year) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  applyPeerFilters(q, opts.filters);
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
  return getJsonAuth<SuggestedQuestionsResponse>(`/institutions/${instId}/suggested-questions?${q}`);
};

// --- briefing ---
export const getBriefing = (
  instId: string,
  start = 2019,
  end = 2024,
  opts: { n?: number; peerIds?: string[] } = {}
) => {
  const q = new URLSearchParams({ start: String(start), end: String(end) });
  if (opts.n) q.set("n", String(opts.n));
  if (opts.peerIds?.length) q.set("peer_ids", opts.peerIds.join(","));
  return getJsonAuth<BriefingResponse>(`/briefing/${instId}?${q}`);
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
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/qa/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<QaResponse>;
}

// --- admin (Kalyan's internal use only, not pilot-facing) ---
export const listAdminUsers = () => getJsonAuth<AdminUser[]>(`/admin/users`);

export const getDataStatus = () => getJsonAuth<DataStatusResponse>(`/admin/data-status`);

export async function inviteAdminUser(email: string, redirectTo: string) {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/admin/users/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json();
}

export async function updateAdminUser(
  userId: string,
  updates: { ai_enabled?: boolean; access_expires_at?: string | null }
) {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json();
}

export async function removeAdminUser(userId: string) {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/admin/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json();
}

// --- usage tracking ---
// One id per browser session (tab open -> close), used to group events
// into a "visit" without a separate sessions table. Cleared on sign-out
// so logging back in in the same tab starts a fresh session.
const USAGE_SESSION_KEY = "herd_usage_session_id";

function getUsageSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem(USAGE_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(USAGE_SESSION_KEY, id);
  }
  return id;
}

export function resetUsageSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(USAGE_SESSION_KEY);
  sessionStorage.removeItem("herd_session_start_logged");
}

// Fire-and-forget: never awaited by callers, never throws, never blocks
// the UI. If this fails (network blip, not logged in yet), it silently
// no-ops -- logging must never break the app.
export async function logEvent(
  eventType: string,
  opts: { institution?: string; tab?: string; question?: string; metadata?: object } = {}
) {
  try {
    const authHeaders = await getAuthHeaders();
    if (!("Authorization" in authHeaders)) return;
    await fetch(`${BASE_URL}/usage/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        event_type: eventType,
        session_id: getUsageSessionId(),
        institution: opts.institution,
        tab: opts.tab,
        question: opts.question,
        metadata: opts.metadata,
      }),
    });
  } catch {
    // fire-and-forget -- never let logging break the app
  }
}
