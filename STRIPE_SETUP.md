# Stripe setup (payments)

Review Miner sells 5 credit packs with **Stripe Checkout** (Stripe's own hosted payment page).
The server creates each checkout, Stripe takes the payment, and credits are added only after the
payment is verified (by the webhook and by the success page, whichever arrives first; never twice).

| Pack | Price | Credits | Live price ID (built into `shared/types.ts`) |
|---|---|---|---|
| Starter | €5 | 30 | `price_1UZFiU0m1Y40xNqf9VLx14aU` |
| Core | €10 | 100 | `price_1UZFqm0m1Y40xNqfMUMZwTue` |
| Pro | €20 | 250 | `price_1UZFru0m1Y40xNqfdhEhQn5c` |
| Elite | €30 | 500 | `price_1UZFsw0m1Y40xNqf9eB84P6O` |
| Apex | €40 | 1000 | `price_1UZFto0m1Y40xNqf1MTq1BFp` |

Before every checkout the server asks Stripe for the pack's price and refuses to sell the pack if it
isn't active, in EUR, and equal to the price in Supabase's `credit_packs` table.

## 1. Restricted API key
Stripe Dashboard → **Developers → API keys → Create restricted key**. Give it exactly:
- **Checkout Sessions: Write**
- **PaymentIntents: Read**
- **Charges: Read** (card/IBAN details on receipts)
- **Prices: Read**

Add it in Cloudflare Pages as `STRIPE_SECRET_KEY` and choose **Encrypt**. Never put it in code or chats.

## 2. Webhook
Stripe Dashboard → **Developers → Webhooks → Add endpoint**
- Endpoint URL: `https://YOUR-SITE/api/stripe-webhook`
- Events: `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`

Copy the endpoint's **Signing secret** (`whsec_…`) into Cloudflare as `STRIPE_WEBHOOK_SECRET` (Encrypt).
The webhook rejects any request without a valid Stripe signature, or older than 5 minutes.

## 3. Payment methods and branding
- **Settings → Payment methods**: turn on Cards (Apple Pay and Google Pay come with cards) and, if you
  want, SEPA Direct Debit (bank debits confirm in 3–5 business days; credits are added then).
- **Settings → Public details**: business name, and your Terms URL `https://YOUR-SITE/terms`. With the
  Terms URL set, buyers must tick "I agree to the Terms" on Stripe's page; without it, the same wording
  is shown as a note above the Pay button.
- **Settings → Branding**: logo, icon and colours for the checkout page.
- **Settings → Customer emails** (optional): Stripe emails a receipt after each payment.

## 4. Test mode vs live mode
The mode follows the key: `rk_test_…` = test mode, `rk_live_…` = live mode. Test and live are fully
separate in Stripe (separate prices, webhooks and secrets).

**To test first:** in Stripe's test mode create the same 5 prices (EUR), then in Cloudflare set
`STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET` (the test webhook's secret) and
`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_CORE`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`, `STRIPE_PRICE_APEX`
(the test price IDs). Pay with card `4242 4242 4242 4242`, any future date, any CVC.

**For live:** delete the five `STRIPE_PRICE_…` settings, use the live key and live webhook secret, redeploy.

## 5. What happens on a purchase
1. **Get Starter** → `POST /api/payments/create` → Supabase creates the order (price from `credit_packs`),
   the price is checked with Stripe, Stripe creates the checkout page → the browser goes to Stripe.
2. Paid → Stripe returns the buyer to `/checkout/success?order=…`, which polls `POST /api/verify-payment`.
   That endpoint asks Stripe directly for the payment; the browser is never trusted.
3. In parallel Stripe calls `/api/stripe-webhook`. Both paths record the payment in `payments` and call
   Supabase's `fulfill_stripe_order`, which checks the amount, currency and account, then adds the
   credits and tier, locked so it happens exactly once per payment.
4. Cancelled → Stripe returns the buyer to `/checkout/cancelled?order=…`, which calls
   `POST /api/payments/cancel`: the Stripe checkout is closed so it can't be paid later.

## 6. Check it
Open `https://YOUR-SITE/admin` → **System check** (key permissions, all 5 prices, checkout creation,
webhook secret, last webhook received). Then make one real purchase and refund it in Stripe.
