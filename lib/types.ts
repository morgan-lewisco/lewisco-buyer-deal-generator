export type LeadStatus = 'new' | 'contacted' | 'dismissed';
export type LeadType = 'both' | 'lookalike' | 'signal';

export interface Lead {
  id: string;
  company: string;
  website: string;
  category: string;
  fitScore: number;       // 0–50
  signalScore: number;    // 0–50
  blendedScore: number;   // 0–100
  whyNow: string;
  signalType: string;
  signalDate: string;
  revenueRange: string;
  employeeSize: string;
  location: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  zoomInfoId?: string;
  source: string;
  leadType?: LeadType;
  sourceUrl?: string;
  status: LeadStatus;
}

export interface SignalEvent {
  type: string;
  weight: number;
}

export interface RevenueBand {
  min: number;
  max: number;
}

export interface ScoringWeights {
  fit: number;
  signal: number;
}

export interface BuyerProfile {
  id: string;
  name: string;
  bio: string;
  badge: { label: string; color: string; emoji: string };
  zohoOwnerName: string;  // exact "First Last" name as it appears in Zoho CRM
  lanes: string[];
  categories: string[];
  seedVendors: string[];
  revenueBand: RevenueBand;
  geographies: string[];
  signalEvents: SignalEvent[];
  scoringWeights: ScoringWeights;
}

export interface GenerateOptions {
  excludeContacted: boolean;
  excludeDismissed: boolean;
  windowDays: number;
}

export interface BuyerState {
  leads: Lead[];
  generatedAt: string | null;
  statusOverrides: Record<string, LeadStatus>;
}

export interface GenerateResult {
  leads: Lead[];
  generatedAt: string;
  searchesRun: number;
  rawSignalsFound: number;
}
