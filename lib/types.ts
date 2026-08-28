export type LeadStatus = 'new' | 'contacted' | 'dismissed';
export type AssignedTo = string; // buyer manager name, e.g. "Dewey Yeager"
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
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  zoomInfoId?: string;
  parentCompany?: string;
  source: string;
  leadType?: LeadType;
  sourceUrl?: string;
  status: LeadStatus;
  assignedTo?: AssignedTo;
  dealMade?: boolean;
  dealNotes?: string;
  adminNotes?: string;
  currentlyActive?: boolean; // manually marked as existing CRM account (overrides auto-detection)
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

export interface ZohoMatch {
  found: boolean;
  boughtManager: string;
  vendorOriginatorByName: string;
  overridden?: boolean; // true when match came from a manual human override
}

export interface PoolState {
  leads: Lead[];
  generatedAt: string | null;
}

export interface GenerateResult {
  leads: Lead[];
  generatedAt: string;
  searchesRun: number;
  rawSignalsFound: number;
}
