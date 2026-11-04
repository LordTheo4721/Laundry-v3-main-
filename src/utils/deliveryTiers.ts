// Branch-to-delivery-tier lookup for San Fernando City, La Union service area.
// Delivery fees are derived from the customer's selected barangay (branch) tier.

export type DeliveryTier = 1 | 2 | 3 | 4;

export interface DeliveryTierInfo {
  tier: DeliveryTier;
  label: string;
  minKm: number;
  maxKm: number | null;
  fee: number;
  configurable: boolean;
}

export const DELIVERY_TIERS: Record<DeliveryTier, DeliveryTierInfo> = {
  1: { tier: 1, label: 'Tier 1 Immediate Zone (0-2 km)', minKm: 0, maxKm: 2, fee: 39, configurable: false },
  2: { tier: 2, label: 'Tier 2 Downtown & Central Core (2-4 km)', minKm: 2, maxKm: 4, fee: 49, configurable: false },
  3: { tier: 3, label: 'Tier 3 Mid-Distance Suburban (4-7 km)', minKm: 4, maxKm: 7, fee: 65, configurable: false },
  4: { tier: 4, label: 'Tier 4 Far Interior / Rural Mountainous (7+ km)', minKm: 7, maxKm: null, fee: 85, configurable: true },
};

export const TIER4_MIN_FEE = 85;
export const TIER4_MAX_FEE = 110;
export const TIER4_DEFAULT_FEE = 85;

const TIER1_BRANCHES = ['Madayegdeg', 'Catbangen', 'Sevilla', 'Canaoay', 'Parian'];
const TIER2_BRANCHES = ['Barangay I', 'Barangay II', 'Barangay III', 'Barangay IV', 'Tanqui', 'Ilocanos Norte', 'Ilocanos Sur', 'Pagdaraoan', 'San Francisco', 'Cabaroan', 'Lingsat', 'Carlatan', 'Biday', 'Pagdalagan'];
const TIER3_BRANCHES = ['Bangcusay', 'Dalumpinas Este', 'Dalumpinas Oeste', 'Dallangayan Este', 'Dallangayan Oeste', 'Cadaclan', 'Santiago Norte', 'Santiago Sur', 'Pagudpud', 'San Vicente', 'Mameltac', 'Baraoas', 'Bato', 'Langcuas', 'Saoay', 'Pao Norte', 'Pao Sur', 'Poro'];
const TIER4_BRANCHES = ['Abut', 'Apaleng', 'Nagyubuyuban', 'Bangbangolan', 'Bungro', 'Cabarsican', 'Calabugao', 'Camansi', 'Chulyao', 'Birunget', 'Masicong', 'Mamat-ing Norte', 'Mamat-ing Sur', 'Namancayan', 'Namarabar', 'Pias', 'Poris', 'Pushweng', 'Sallacong', 'San Guillermo', 'Siboan-Otong'];

const BRANCH_TIER_MAP: Record<string, DeliveryTier> = {};
TIER1_BRANCHES.forEach(b => { BRANCH_TIER_MAP[b] = 1; });
TIER2_BRANCHES.forEach(b => { BRANCH_TIER_MAP[b] = 2; });
TIER3_BRANCHES.forEach(b => { BRANCH_TIER_MAP[b] = 3; });
TIER4_BRANCHES.forEach(b => { BRANCH_TIER_MAP[b] = 4; });

export function getBranchTier(branch: string): DeliveryTier | null {
  return BRANCH_TIER_MAP[branch] ?? null;
}

export function isValidBranch(branch: string): boolean {
  return branch in BRANCH_TIER_MAP;
}

export function getDeliveryFeeByBranch(branch: string, tier4Fee: number = TIER4_DEFAULT_FEE): number {
  const tier = getBranchTier(branch);
  if (tier === null) return 0;
  if (tier === 4) {
    const clamped = Math.min(TIER4_MAX_FEE, Math.max(TIER4_MIN_FEE, tier4Fee));
    return clamped;
  }
  return DELIVERY_TIERS[tier].fee;
}

export function getTierLabel(branch: string): string {
  const tier = getBranchTier(branch);
  if (tier === null) return 'Unknown';
  return DELIVERY_TIERS[tier].label;
}
