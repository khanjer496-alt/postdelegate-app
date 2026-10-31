import { DEFAULT_AFFILIATE_COOKIE_DAYS } from '@gitroom/helpers/affiliate/affiliate.cookie';

const positiveInt = (name: string, fallback: number) => {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// Read on every call so the values follow the environment of the process
export const getAffiliateConfig = () => ({
  commissionPercent: Math.min(positiveInt('AFFILIATE_COMMISSION_PERCENT', 30), 100),
  commissionMonths: positiveInt('AFFILIATE_COMMISSION_MONTHS', 12),
  holdDays: positiveInt('AFFILIATE_HOLD_DAYS', 30),
  cookieDays: positiveInt(
    'AFFILIATE_COOKIE_DAYS',
    DEFAULT_AFFILIATE_COOKIE_DAYS
  ),
  minPayoutUsd: positiveInt('AFFILIATE_MIN_PAYOUT_USD', 50),
});
