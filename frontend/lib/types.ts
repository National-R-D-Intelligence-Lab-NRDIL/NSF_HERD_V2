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
