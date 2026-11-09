// Types and constants shared by the React app and the Cloudflare functions.

export type FocusKey = 'love' | 'complaints' | 'wishes' | 'buyers' | 'ads';

export const FOCUS_KEYS: FocusKey[] = ['love', 'complaints', 'wishes', 'buyers', 'ads'];

export const FOCUS_OPTIONS: { key: FocusKey; emoji: string; label: string }[] = [
  { key: 'love', emoji: '😍', label: 'What people love' },
  { key: 'complaints', emoji: '😤', label: 'Common complaints' },
  { key: 'wishes', emoji: '💡', label: 'What they wish it had' },
  { key: 'buyers', emoji: '👥', label: 'Who’s buying it' },
  { key: 'ads', emoji: '📣', label: 'Ad ideas' },
];

export const DEFAULT_FOCUSES: FocusKey[] = ['love', 'complaints', 'wishes'];

export type Detail = 'quick' | 'detailed';

export interface UserSettings {
  default_focuses: FocusKey[];
  detail: Detail;
}

export const DEFAULT_SETTINGS: UserSettings = { default_focuses: DEFAULT_FOCUSES, detail: 'quick' };

export interface CreditTransaction {
  id: string;
  amount: number;
  balance_after: number;
  reason: 'signup_bonus' | 'analysis' | 'follow_up' | 'purchase' | 'refund' | 'voucher';
  created_at: string;
}

export type Frequency = 'many' | 'some' | 'few';
export type DataQuality = 'good' | 'limited' | 'none';

export interface ThemeItem {
  theme: string;
  detail: string;
  frequency: Frequency;
  quote: string | null;
}

export interface Report {
  product_name: string;
  verdict: string;
  average_rating: number | null;
  review_count: number | null;
  sentiment: { positive: number; neutral: number; negative: number };
  love: ThemeItem[];
  complaints: ThemeItem[];
  wishes: { idea: string; detail: string }[];
  buyers: { type: string; why: string }[];
  ads: { headline: string; body: string }[];
  answer: string | null;
  data_quality: DataQuality;
  data_note: string;
}

export interface Analysis {
  id: string;
  group_id: string | null;
  url: string;
  product_name: string | null;
  focuses: FocusKey[];
  question: string | null;
  report: Report;
  created_at: string;
}

export interface AnalysisSummary {
  id: string;
  group_id: string | null;
  url: string;
  product_name: string | null;
  created_at: string;
}

export interface FollowUpAnswer {
  answer: string;
  points: string[];
}

export interface FollowUp {
  id: string;
  analysis_id: string;
  question: string;
  answer: FollowUpAnswer;
  created_at: string;
}

// ---- Credits & pricing ----
export const PROMPT_COST = 1.5; // every prompt: a product link or a follow-up question
export const LINK_COST = PROMPT_COST;
export const FOLLOW_UP_COST = PROMPT_COST;
export const SIGNUP_CREDITS = 15; // = 10 links at 1.5 credits each
export const MAX_LINKS = 5; // links per message

export type PackId = 'starter' | 'core' | 'pro' | 'elite' | 'apex';

export interface CreditPack {
  name: string;
  credits: number;
  /** Your Stripe price for this pack (public ID, safe to keep in code). */
  stripePriceId: string;
  price: number; // in euros. Keep in sync with the credit_packs table in Supabase.
  bestFor: string;
  badge?: string;
}

export const CREDIT_PACKS: Record<PackId, CreditPack> = {
  starter: { name: 'Starter', credits: 30, stripePriceId: 'price_1UZFiU0m1Y40xNqf9VLx14aU', price: 5, bestFor: 'Checking a few big purchases' },
  core: { name: 'Core', credits: 100, stripePriceId: 'price_1UZFqm0m1Y40xNqfMUMZwTue', price: 10, bestFor: 'Comparing a whole product category' },
  pro: { name: 'Pro', credits: 250, stripePriceId: 'price_1UZFru0m1Y40xNqfdhEhQn5c', price: 20, bestFor: 'Sellers keeping an eye on competitors', badge: 'Most popular' },
  elite: { name: 'Elite', credits: 500, stripePriceId: 'price_1UZFsw0m1Y40xNqf9eB84P6O', price: 30, bestFor: 'Stores with a full catalog to research' },
  apex: { name: 'Apex', credits: 1000, stripePriceId: 'price_1UZFto0m1Y40xNqf1MTq1BFp', price: 40, bestFor: 'Agencies and teams', badge: 'Best value' },
};

export const PACK_ORDER: PackId[] = ['starter', 'core', 'pro', 'elite', 'apex'];

// ---- Currency ----
export const CURRENCY = 'EUR';

/** €5, €12.50, €0.25 */
export function formatPrice(amount: number): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCredits(n: number): string {
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---- API contracts ----
export interface MineRequest {
  url: string;
  focuses: FocusKey[];
  question: string | null;
  detail?: Detail;
  /** Links sent together share a group id so they become one chat. */
  groupId?: string | null;
}
export interface MineResponse {
  analysis: Analysis;
  credits: number;
}
export interface AskRequest {
  /** One product, or several products from the same chat (max 5). */
  analysisId?: string;
  analysisIds?: string[];
  question: string;
}
export interface AskResponse {
  followUp: FollowUp;
  credits: number;
}
// ---- Tiers ----
export const TIERS = ['Free', 'Starter', 'Core', 'Pro', 'Elite', 'Apex'] as const;
export type Tier = (typeof TIERS)[number];
export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as readonly string[]).includes(v);

// ---- Vouchers ----
// Codes look like RM-ABCD-EFGH or APEX-1000-ABCD-EFGH: letters/numbers in dash-separated groups.
export const VOUCHER_PATTERN = /^[A-Z0-9]{2,12}(-[A-Z0-9]{2,12}){1,5}$/;
const UUID_LIKE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/** Tidies a typed or linked code ("apex-1000-abcd-efgh " → "APEX-1000-ABCD-EFGH"). Returns null if it can't be a voucher. */
export function normalizeVoucher(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 60) return null;
  let code = input.toUpperCase().replace(/\s+/g, '');
  if (/^RM[A-Z0-9]{8}$/.test(code)) code = `RM-${code.slice(2, 6)}-${code.slice(6)}`; // old codes typed without dashes
  if (code.length > 40 || UUID_LIKE.test(code)) return null; // sign-in links use UUIDs, never vouchers
  return VOUCHER_PATTERN.test(code) ? code : null;
}

export interface RedeemRequest {
  code: string;
  /** Optional. Must match the signed-in account if sent. */
  userId?: string;
}
export interface RedeemResponse {
  success: true;
  newCredits: number;
  creditsAdded: number;
  newTier: Tier;
  tierUpgraded: boolean;
}

// ---- Buying voucher codes ----
/** Bump this whenever the Terms and Conditions change. */
export const TERMS_VERSION = '2026-11-08.2';

// ---- Buying credit packs (card, Apple Pay, Google Pay, SEPA Direct Debit) ----
export type OrderStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled';

export interface VoucherOrder {
  id: string;
  pack: PackId;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  paymentMethod: 'stripe' | 'bank_transfer' | 'card';
  gift: boolean;
  createdAt: string;
  paidAt: string | null;
  /** e.g. "Visa •••• 4242 · debit card", "Apple Pay (Visa •••• 4242)", "SEPA Direct Debit •••• 3000" */
  methodLabel: string | null;
  payerName: string | null;
  receiptNumber: string | null;
  /** Stripe's payment ID (or the bank reference for old bank-transfer orders). */
  paymentReference: string | null;
  failureMessage: string | null;
  /** Only once paid. For non-gift orders the code has already been used on the buyer's account. */
  code: string | null;
  redeemed: boolean | null;
}

export interface CheckoutStartRequest {
  pack: PackId;
  /** The Terms are accepted on Stripe's page (a required checkbox), so these are optional. */
  acceptedTerms?: boolean;
  termsVersion?: string;
}
export interface CheckoutStartResponse {
  orderId: string;
  /** Stripe's checkout page. Send the buyer here. */
  url: string;
}
export interface OrderIdRequest {
  orderId: string;
}
export interface CheckoutStatusResponse {
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'requires_action';
  order: VoucherOrder;
  /** The buyer's new balance when the credits were just added. */
  newCredits: number | null;
  message: string | null;
}
export interface CancelCheckoutResponse {
  /** cancelled: closed, nothing charged · paid: it was paid after all (show the receipt) · already_closed */
  status: 'cancelled' | 'paid' | 'already_closed';
}
export interface MyOrdersResponse {
  orders: VoucherOrder[];
}
export interface MeResponse {
  isAdmin: boolean;
}

// ---- Admin ----
export interface AdminOrder extends VoucherOrder {
  buyerEmail: string | null;
  amountReceivedCents: number | null;
}
// ---- Admin: users, credits, transactions, stats ----
export interface AdminUser {
  userId: string;
  email: string | null;
  credits: number;
  tier: Tier;
  createdAt: string;
}
export interface AdminUsersRequest {
  search?: string;
}
export interface AdminUsersResponse {
  users: AdminUser[];
}
export interface AdminTransaction {
  id: string;
  userId: string;
  email: string | null;
  amount: number;
  balanceAfter: number;
  reason: string;
  note: string | null;
  createdAt: string;
}
export interface AdminTransactionsResponse {
  transactions: AdminTransaction[];
}
export interface AdminUserDetailResponse {
  user: AdminUser;
  isAdmin: boolean;
  transactions: AdminTransaction[];
  orders: VoucherOrder[];
  usage: { requests30d: number; errors30d: number; lastRequestAt: string | null };
  analysesCount: number;
}
export interface AdminAdjustCreditsRequest {
  userId: string;
  /** Positive to add, negative to remove; steps of 0.5. */
  amount: number;
  note: string;
}
export interface AdminSetTierRequest {
  userId: string;
  tier: Tier;
}
export interface AdminStatsResponse {
  users: { total: number; new7d: number; new30d: number };
  revenue: { paid30dCents: number; orders30d: number; paidAllCents: number; ordersAll: number };
  ai: {
    requests24h: number;
    errors24h: number;
    requests30d: number;
    inputTokens30d: number;
    outputTokens30d: number;
    webSearches30d: number;
    creditsSpent30d: number;
  };
  creditsOutstanding: number;
}

export interface AdminOrdersResponse {
  orders: AdminOrder[];
}

// ---- Admin system check ----
export interface HealthCheck {
  group: 'Supabase' | 'Stripe' | 'AI' | 'Settings';
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}
export interface HealthResponse {
  checks: HealthCheck[];
  stripeMode: 'live' | 'test' | null;
  checkedAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
