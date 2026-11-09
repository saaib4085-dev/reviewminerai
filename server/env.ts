export interface Env {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;
  /** Web searches Claude may run per product (default 3, max 10). */
  ANTHROPIC_MAX_SEARCHES?: string;
  /** AI requests allowed per user per hour / per day (defaults 30 / 200). */
  AI_HOURLY_LIMIT?: string;
  AI_DAILY_LIMIT?: string;
  /** Optional: reads the product page first. Without it (or if a store blocks it), web search alone is used. */
  FIRECRAWL_API_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  // Stripe: a restricted key (Checkout Sessions: Write, PaymentIntents: Read, Charges: Read,
  // Prices: Read) and the signing secret of your webhook endpoint. Both as encrypted secrets.
  // Test or live mode is decided by the key itself (rk_test_… / rk_live_…).
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Optional: price IDs that replace the built-in live ones, e.g. test-mode prices
  // while STRIPE_SECRET_KEY is a test key (rk_test_… / sk_test_…).
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_CORE?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_ELITE?: string;
  STRIPE_PRICE_APEX?: string;
  APP_URL?: string;
}
