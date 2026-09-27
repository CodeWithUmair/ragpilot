// src/lib/plans.ts
//
// Mirrors backend/src/lib/plans.ts. Limits here are for UI display only;
// the backend is authoritative for enforcement. If you change one file,
// change the other.

import type { LucideIcon } from 'lucide-react';
import { Sparkles, Rocket } from 'lucide-react';

export type PlanKey = 'free' | 'pro';

export type FeatureFlag =
  | 'crawl'
  | 'fileUpload'
  | 'leadCapture'
  | 'googleSheets'
  | 'proactiveCta'
  | 'removeBranding';

export interface PlanConfig {
  key: PlanKey;
  label: string;
  price: number;
  priceLabel: string;
  messageLimit: number;
  chatbotLimit: number;
  features: Record<FeatureFlag, boolean>;
  featureList: string[];
  description: string;
  popular?: boolean;
  // UI-only fields
  icon: LucideIcon;
  accentClass: string;
  bgClass: string;
  borderClass: string;
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  free: {
    key: 'free',
    label: 'Free',
    price: 0,
    priceLabel: '$0',
    messageLimit: 100,
    chatbotLimit: 1,
    features: {
      crawl: true,
      fileUpload: true,
      leadCapture: false,
      googleSheets: false,
      proactiveCta: false,
      removeBranding: false,
    },
    featureList: [
      '1 chatbot',
      '100 messages / month',
      'Website crawler',
      'File upload (PDF, DOCX, TXT, CSV)',
    ],
    description: 'Try it out. Best for testing or small personal sites.',
    icon: Sparkles,
    accentClass: 'text-slate-500',
    bgClass: 'bg-slate-50 dark:bg-slate-900/40',
    borderClass: 'border-slate-200 dark:border-slate-700',
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    price: 29,
    priceLabel: '$29',
    messageLimit: 2000,
    chatbotLimit: 3,
    features: {
      crawl: true,
      fileUpload: true,
      leadCapture: true,
      googleSheets: true,
      proactiveCta: true,
      removeBranding: true,
    },
    featureList: [
      '3 chatbots',
      '2,000 messages / month',
      'Lead capture → Google Sheets',
      'Proactive CTA bubble',
      'Remove "Powered by" branding',
      'Conversation analytics',
    ],
    description: 'For real businesses capturing leads on their site.',
    popular: true,
    icon: Rocket,
    accentClass: 'text-violet-500',
    bgClass: 'bg-violet-50 dark:bg-violet-950/20',
    borderClass: 'border-violet-200 dark:border-violet-800',
  },
};

export const PLAN_LIST: PlanConfig[] = [PLANS.free, PLANS.pro];

export function getPlan(plan: string | null | undefined): PlanConfig {
  if (plan && plan in PLANS) return PLANS[plan as PlanKey];
  return PLANS.free;
}

export function planAllows(plan: string, feature: FeatureFlag): boolean {
  return getPlan(plan).features[feature];
}
