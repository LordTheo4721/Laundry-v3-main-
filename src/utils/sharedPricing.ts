// Shared pricing types and logic for both frontend and backend
// This eliminates duplication across 5 locations

export type PricingType = 'tiered' | 'per_kg';

export interface PricingConfig {
  pricing_type: PricingType;
  base_price: number;
  tier_1_limit: number;
  tier_1_price: number;
  tier_2_limit: number;
  tier_2_price: number;
  tier_3_limit: number;
  tier_3_price: number;
  tier_4_limit: number;
  tier_4_price: number;
  tier_5_price_per_kg: number;
  per_kg_price: number;
  is_active: number;
  delivery_fee: number;
}

export interface PricingRow {
  service_type: string;
  pricing_type: PricingType;
  base_price: number;
  tier_1_limit: number;
  tier_1_price: number;
  tier_2_limit: number;
  tier_2_price: number;
  tier_3_limit: number;
  tier_3_price: number;
  tier_4_limit: number;
  tier_4_price: number;
  tier_5_price_per_kg: number;
  per_kg_price: number;
  is_active: number;
  delivery_fee: number;
}

/**
 * Calculate price for a service type and quantity using tiered or per-kg pricing
 * This is the single source of truth for pricing calculations
 */
export function calculatePrice(config: PricingConfig, quantity: number): number {
  const qty = quantity || 1;
  
  if (config.pricing_type === 'tiered') {
    if (qty <= config.tier_1_limit) return config.tier_1_price;
    else if (qty <= config.tier_2_limit) return config.tier_2_price;
    else if (qty <= config.tier_3_limit) return config.tier_3_price;
    else if (qty <= config.tier_4_limit) return config.tier_4_price;
    else return config.tier_4_price + Math.max(0, qty - config.tier_4_limit) * config.tier_5_price_per_kg;
  } else {
    // Per kg/piece pricing
    return config.per_kg_price * qty;
  }
}

/**
 * Calculate unit price (total / quantity) for display purposes
 */
export function calculateUnitPrice(config: PricingConfig, quantity: number): number {
  const total = calculatePrice(config, quantity);
  return quantity > 0 ? total / quantity : 0;
}

/**
 * Calculate grand total for multiple items grouped by service type
 * Uses tiered pricing per service type (quantities are summed per service type)
 */
export function calculateGrandTotal(
  items: Array<{ service_type: string; quantity: number; unit_price?: number }>,
  pricingMap: Map<string, PricingConfig>
): number {
  // Group items by service type
  const itemsByService: Record<string, number> = {};
  items.forEach(item => {
    itemsByService[item.service_type] = (itemsByService[item.service_type] || 0) + item.quantity;
  });
  
  // Calculate total using tiered pricing for each service type
  let total = 0;
  Object.entries(itemsByService).forEach(([serviceType, qty]) => {
    const config = pricingMap.get(serviceType);
    if (config) {
      total += calculatePrice(config, qty);
    }
  });
  return total;
}

/**
 * Calculate grand total with fallback pricing (for when pricingMap is not available)
 */
export function calculateGrandTotalLegacy(
  items: Array<{ service_type: string; quantity: number; unit_price?: number }>
): number {
  // Convert FALLBACK_PRICING to Map for proper fallback calculation
  const fallbackMap = new Map<string, PricingConfig>(
    Object.entries(FALLBACK_PRICING) as [string, PricingConfig][]
  );
  return calculateGrandTotal(items, fallbackMap);
}

/**
 * Convert database pricing row to PricingConfig
 */
export function rowToConfig(row: PricingRow): PricingConfig {
  return {
    pricing_type: row.pricing_type,
    base_price: row.base_price,
    tier_1_limit: row.tier_1_limit,
    tier_1_price: row.tier_1_price,
    tier_2_limit: row.tier_2_limit,
    tier_2_price: row.tier_2_price,
    tier_3_limit: row.tier_3_limit,
    tier_3_price: row.tier_3_price,
    tier_4_limit: row.tier_4_limit,
    tier_4_price: row.tier_4_price,
    tier_5_price_per_kg: row.tier_5_price_per_kg,
    per_kg_price: row.per_kg_price,
    is_active: row.is_active,
    delivery_fee: row.delivery_fee,
  };
}

/**
 * Get the delivery fee from pricing config (for Pick-up & Delivery orders)
 * Returns 0 for Drop-off orders
 */
export function getDeliveryFee(config: PricingConfig): number {
  return config.delivery_fee || 0;
}

/**
 * Hardcoded fallback pricing for when database is unavailable
 * This matches the seeded database values in server.ts
 */
export const FALLBACK_PRICING: Record<string, PricingConfig> = {
   'Wash & Fold (Clothes)': {
      pricing_type: 'tiered',
      base_price: 0,
      tier_1_limit: 5,
      tier_1_price: 200,    // 1-5 kg: ₱200
      tier_2_limit: 7,
      tier_2_price: 250,    // 6-7 kg: ₱250
      tier_3_limit: 8,
      tier_3_price: 300,    // 8 kg: ₱300
      tier_4_limit: 9,
      tier_4_price: 350,    // 9 kg: ₱350
      tier_5_price_per_kg: 50, // 10+ kg: ₱50/kg
      per_kg_price: 0,
      is_active: 1,
      delivery_fee: 50,
    },
    'Comforter (Small)': {
      pricing_type: 'per_kg',
      base_price: 0,
      tier_1_limit: 0,
      tier_1_price: 0,
      tier_2_limit: 0,
      tier_2_price: 0,
      tier_3_limit: 0,
      tier_3_price: 0,
      tier_4_limit: 0,
      tier_4_price: 0,
      tier_5_price_per_kg: 0,
      per_kg_price: 250,
      is_active: 1,
      delivery_fee: 50,
    },
    'Comforter (Medium)': {
      pricing_type: 'per_kg',
      base_price: 0,
      tier_1_limit: 0,
      tier_1_price: 0,
      tier_2_limit: 0,
      tier_2_price: 0,
      tier_3_limit: 0,
      tier_3_price: 0,
      tier_4_limit: 0,
      tier_4_price: 0,
      tier_5_price_per_kg: 0,
      per_kg_price: 300,
      is_active: 1,
      delivery_fee: 50,
    },
    'Comforter (Large)': {
      pricing_type: 'per_kg',
      base_price: 0,
      tier_1_limit: 0,
      tier_1_price: 0,
      tier_2_limit: 0,
      tier_2_price: 0,
      tier_3_limit: 0,
      tier_3_price: 0,
      tier_4_limit: 0,
      tier_4_price: 0,
      tier_5_price_per_kg: 0,
      per_kg_price: 350,
      is_active: 1,
      delivery_fee: 50,
    },
    'Bedsheet/Curtain/Towel': {
      pricing_type: 'per_kg',
      base_price: 0,
      tier_1_limit: 0,
      tier_1_price: 0,
      tier_2_limit: 0,
      tier_2_price: 0,
      tier_3_limit: 0,
      tier_3_price: 0,
      tier_4_limit: 0,
      tier_4_price: 0,
      tier_5_price_per_kg: 0,
      per_kg_price: 50,
      is_active: 1,
      delivery_fee: 50,
    },
     'Hand Wash Service': {
       pricing_type: 'per_kg',
       base_price: 0,
       tier_1_limit: 0,
       tier_1_price: 0,
       tier_2_limit: 0,
       tier_2_price: 0,
       tier_3_limit: 0,
       tier_3_price: 0,
       tier_4_limit: 0,
       tier_4_price: 0,
       tier_5_price_per_kg: 0,
       per_kg_price: 50,
       is_active: 1,
       delivery_fee: 0,
     },
  };

/**
 * Get pricing config with fallback to hardcoded values
 */
export function getPricingConfig(
  serviceType: string,
  pricingMap: Map<string, PricingConfig>
): PricingConfig {
  return pricingMap.get(serviceType) || FALLBACK_PRICING[serviceType] || {
     pricing_type: 'per_kg',
     base_price: 0,
     tier_1_limit: 0,
     tier_1_price: 0,
     tier_2_limit: 0,
     tier_2_price: 0,
     tier_3_limit: 0,
     tier_3_price: 0,
     tier_4_limit: 0,
     tier_4_price: 0,
     tier_5_price_per_kg: 0,
     per_kg_price: 0,
     is_active: 0,
     delivery_fee: 50,
   };
}

/**
 * Calculate price with fallback - main entry point for frontend
 */
export function calculatePriceWithFallback(
  serviceType: string,
  quantity: number,
  pricingMap: Map<string, PricingConfig>
): number {
  const config = getPricingConfig(serviceType, pricingMap);
  return calculatePrice(config, quantity);
}

/**
 * Haversine distance in kilometers between two lat/lng points
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate delivery fee from origin/zone/bands (client-side mirror of backend)
 */
export function calculateDeliveryFeeFromConfig(
  origin: { latitude: number; longitude: number },
  zone: { latitude: number; longitude: number },
  bands: Array<{ min_km: number; max_km: number; fee: number; sort_order?: number }>
): { distance_km: number; fee: number } {
  const distance = haversineKm(origin.latitude, origin.longitude, zone.latitude, zone.longitude);
  const sorted = [...bands].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.min_km - b.min_km);
  let fee = 0;
  for (const band of sorted) {
    if (distance >= band.min_km && distance <= band.max_km) { fee = band.fee; break; }
  }
  if (fee === 0 && sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    if (distance > last.max_km) fee = last.fee;
  }
  return { distance_km: Math.round(distance * 100) / 100, fee };
}

/**
 * Backward-compatible calculatePrice function that uses fallback pricing
 * This matches the old signature: (serviceType: string, quantity: number) => number
 */
export function calculatePriceLegacy(serviceType: string, quantity: number): number {
  return calculatePriceWithFallback(serviceType, quantity, new Map());
}