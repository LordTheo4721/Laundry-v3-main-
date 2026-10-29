// Re-export shared pricing logic for backward compatibility
export {
  calculatePriceLegacy as calculatePrice,
  calculateGrandTotalLegacy as calculateGrandTotal,
  calculateGrandTotal as calculateGrandTotalWithMap,
  calculatePriceWithFallback,
  FALLBACK_PRICING,
  type PricingConfig
} from './sharedPricing';
