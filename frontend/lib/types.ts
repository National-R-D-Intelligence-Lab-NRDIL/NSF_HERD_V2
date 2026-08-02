export interface InstitutionListItem {
  inst_id: string;
  name: string;
  state: string;
  year: number;
  total_rd: number;
  national_rank: number;
}

export interface InstitutionDetail {
  inst_id: string;
  name: string;
  state: string;
  year: number;
  total_rd: number;
  federal: number;
  national_rank: number;
  state_rank: number;
}

export interface RankPoint {
  year: number;
  national_rank: number;
  total_rd: number;
}

export interface AnchorRow {
  inst_id: string;
  name: string;
  total_rd: number;
  national_rank: number;
  is_target: boolean;
}

export interface AnchorResponse {
  target_rank: number;
  total_institutions: number;
  anchors: AnchorRow[];
}

export interface FundingBreakdown {
  breakdown: {
    federal: number;
    state_local: number;
    business: number;
    nonprofit: number;
    institutional: number;
    other_sources: number;
    total_rd: number;
  };
  trend: { year: number; federal_pct: number }[];
  national_median_federal_pct: number;
}

export interface StateRanking {
  state: string;
  state_rank: number;
  market_share_pct: number;
  institutions: { inst_id: string; name: string; total_rd: number; state_rank: number }[];
}

export interface PeersResponse {
  inst_id: string;
  peer_inst_ids: string[];
  candidate_pool_size?: CandidatePoolSize;
}

export interface GapRow {
  metric: string;
  my_val: number;
  peer_avg: number;
  gap: number;
}

export interface GapResponse {
  inst_id: string;
  gaps: GapRow[];
  custom_peer_mode: boolean;
}

export interface TrendRow {
  inst_id: string;
  year: number;
  total_rd: number;
  name: string;
  is_target: boolean;
}

export interface TrendStats {
  target_cagr: number;
  peer_avg_cagr: number;
  growth_rank: number | null;
  total_in_group: number;
}

export interface PeerTrendResponse {
  trend: TrendRow[];
  stats: TrendStats;
  custom_peer_mode: boolean;
}

export interface FieldPortfolioRow {
  field_code: string;
  field_name: string;
  federal: number;
  nonfederal: number;
  field_total: number;
  field_share_pct: number;
}

export interface FieldDrilldownRow {
  field_code: string;
  field_name: string;
  federal: number;
  nonfederal: number;
  total: number;
  share_of_parent: number;
}

export interface FieldMomentumRow {
  field_code: string;
  field_name: string;
  field_total: number;
  field_share_pct: number;
  cagr_pct: number | null;
}

export interface AgencyRow {
  agency_code: string;
  agency_name: string;
  amount: number;
  pct_of_federal: number;
}

export interface AgencyTrendRow {
  year: number;
  agency_code: string;
  agency_name: string;
  amount: number;
}

export interface ConcentrationResponse {
  hhi: number;
  diversification_score: number;
  top_agency: string;
  top_agency_pct: number;
  national_percentile: number;
  total_institutions: number;
}

export interface FieldPeerComparisonRow {
  field_code: string;
  field_name: string;
  your_pct: number;
  your_total: number;
  peer_avg_pct: number;
  difference: number;
}

export interface FieldPeerComparisonResponse {
  comparison: FieldPeerComparisonRow[];
  custom_peer_mode: boolean;
}

export interface AgencyPeerComparisonRow {
  agency_code: string;
  agency_name: string;
  your_pct: number;
  peer_avg_pct: number;
  difference: number;
}

export interface AgencyPeerComparisonResponse {
  comparison: AgencyPeerComparisonRow[];
  custom_peer_mode: boolean;
}

export interface StrategicInsight {
  insight: string;
  target_growth: number;
  peer_avg: number;
  peer_desc: string;
  top_field: string | null;
  top_field_pct: number | null;
  top_agency: string | null;
  top_agency_pct: number | null;
}

export interface QaResponse {
  sql: string;
  results: Record<string, unknown>[];
  summary: string;
}

export interface SuggestedQuestionGroup {
  label: string;
  questions: string[];
}

export interface SuggestedQuestionsResponse {
  groups: SuggestedQuestionGroup[];
}

export interface ClassificationData {
  inst_id: string;
  unitid: string | null;
  carnegie_class: string;
  control: string;
  has_med_school: boolean;
  is_aau: boolean;
  is_aplu: boolean;
  is_hbcu: boolean;
  is_hsi: boolean;
  is_epscor: boolean;
}

export interface ClassificationOptions {
  carnegie_classes: string[];
  controls: string[];
  counts: {
    total: number;
    med_school: number;
    aau: number;
    aplu: number;
    hbcu: number;
    hsi: number;
    epscor: number;
  };
}

export interface PeerFilters {
  carnegie?: string[];
  control?: string;
  exclude_med?: boolean;
  aau_only?: boolean;
  aplu_only?: boolean;
  hbcu_only?: boolean;
  hsi_only?: boolean;
  epscor_only?: boolean;
}

export interface CandidatePoolSize {
  total: number;
  filtered: number;
}

export interface PeerMovementRow {
  inst_id: string;
  name: string;
  rank_start: number | null;
  rank_end: number | null;
  rank_delta: number | null;
  total_rd_end: number;
  dollar_gap: number | null;
  cagr_pct: number | null;
  is_converging: boolean;
}

export interface PeerMovementResponse {
  inst_id: string;
  start: number;
  end: number;
  peers: PeerMovementRow[];
  target: {
    rank_start: number | null;
    rank_end: number | null;
    rank_delta: number | null;
    total_rd_end: number | null;
    cagr_pct: number | null;
  };
  custom_peer_mode: boolean;
}

export interface BriefingSection {
  title: string;
  body: string;
}

export interface BriefingKeyMetric {
  label: string;
  value: string;
}

export interface BriefingPeerRow {
  name: string;
  rank: number;
  total_rd: number;
  is_target: boolean;
}

export interface BriefingRankPoint {
  year: number;
  national_rank: number;
  total_rd: number;
}

export interface BriefingResponse {
  institution_name: string;
  state: string;
  year: number;
  headline: string;
  sections: BriefingSection[];
  footnote: string;
  key_metrics: BriefingKeyMetric[];
  peer_table: BriefingPeerRow[];
  rank_trend: BriefingRankPoint[];
}
