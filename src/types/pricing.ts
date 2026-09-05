import { AccessTier } from '@/lib/feature-flags';

export interface PricingPlan {
  id: string;
  name: string;
  tier: AccessTier;
  priceMonthly: number;
  priceYearly: number;
  stripePriceId?: string;
  stripeYearlyPriceId?: string;
  description: string;
  features: PricingFeature[];
  cta: string;
  popular?: boolean;
}

export interface PricingFeature {
  label: string;
  included: boolean;
  tier: AccessTier;
}

export interface PricingComparisonRow {
  category: string;
  features: {
    label: string;
    free: boolean | string;
    pro: boolean | string;
    enterprise: boolean | string;
  }[];
}
