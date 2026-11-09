# Review Miner

Paste a product link, get a plain-English summary of what buyers say: what they love, common complaints,
what they wish it had, who's buying it, and ad ideas.

**Stack:** React + Vite + Tailwind (website) · Cloudflare Pages Functions (backend, `functions/api/`) ·
Supabase (database, Google sign-in and email sign-in links) · Stripe Checkout (payments) ·
Anthropic Claude with web search (AI) · Firecrawl (reads product pages).

---

## Deploy to Cloudflare Pages

You'll need accounts at Cloudflare, GitHub, Supabase, Stripe, Anthropic, Google Cloud and (recommended)
Firecrawl. Do the steps in order.

### 1. Supabase: database
1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste all of `supabase/migrations/000_SETUP_ALL.sql` → **Run**.
   It contains every migration (001–017), is safe to run again, and ends with a summary:
   5 credit packs, 1000 RM vouchers, 100 Apex vouchers.
3. From **Project Settings → API**, note the **Project URL**, the **anon public key** and the
   **service_role key** (keep the service_role key secret).

### 2. GitHub
Create a repository and upload the **contents of this folder** so that `package.json`, `functions/`
and `src/` are at the top level of the repository. `node_modules` and `dist` are not needed.

### 3. Cloudflare Pages project
1. Cloudflare → **Workers & Pages → Create → Pages** (not a Worker) → **Import an existing Git repository**.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | *(empty)* |

3. **Environment variables**: add them **before the first deploy**, because `VITE_` values are built
   into the website. See the table below. Choose **Encrypt** for every secret.
4. **Save and Deploy.** Your site appears at `https://<project>.pages.dev`. Add your own domain under
   **Custom domains** if you have one.

### 4. Environment variables
Names are also listed in `.env.example`.

| Variable | Required | Secret | What it is |
|---|---|---|---|
| `VITE_SUPABASE_URL` | yes | | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | | Supabase anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **yes** | Supabase service_role key (server only) |
| `STRIPE_SECRET_KEY` | for payments | **yes** | Restricted key: Checkout Sessions Write, PaymentIntents Read, Charges Read, Prices Read |
| `STRIPE_WEBHOOK_SECRET` | for payments | **yes** | Signing secret of the webhook endpoint |
| `ANTHROPIC_API_KEY` | for AI | **yes** | console.anthropic.com → API keys |
| `FIRECRAWL_API_KEY` | recommended | **yes** | firecrawl.dev; without it the AI uses web search only |
| `APP_URL` | recommended | | Your live address, e.g. `https://reviewminer.com` (Stripe return pages) |
| `VITE_OPERATOR_NAME`, `VITE_CONTACT_EMAIL` | recommended | | Shown in the Privacy Policy and Terms |
| `NODE_VERSION` | recommended | | `22` (also pinned in `.node-version`) |
| `ANTHROPIC_MODEL` | optional | | Default `claude-haiku-5-5` |
| `ANTHROPIC_MAX_SEARCHES` | optional | | Web searches per product, default 3 (max 10) |
| `AI_HOURLY_LIMIT`, `AI_DAILY_LIMIT` | optional | | AI requests per user, defaults 30 / 200 |
| `STRIPE_PRICE_STARTER` … `_APEX` | **test mode only** | | Test-mode price IDs. Leave unset in live mode |

After changing variables, redeploy (Deployments → ⋯ → Retry deployment).

### 5. Supabase: sign-in settings
**Authentication → URL Configuration**
- Site URL: `https://YOUR-SITE`
- Redirect URLs: `https://YOUR-SITE/**`

Email sign-in links work straight away. For Google, follow **`GOOGLE_SIGN_IN.md`**.

### 6. Stripe
Follow **`STRIPE_SETUP.md`**: restricted key, webhook at `https://YOUR-SITE/api/stripe-webhook`,
payment methods, Terms URL, branding, and test vs live mode.

### 7. Anthropic
Create an API key, add billing, and switch **web search** on for your organisation in the Claude Console
(Settings → Privacy). Web search is billed per search on top of tokens.

### 8. Make yourself admin
Sign in once on your site, then in Supabase's SQL Editor:
```sql
insert into public.app_admins (user_id) select id from auth.users where email = 'you@example.com';
```
Open `https://YOUR-SITE/admin` → **System check** to confirm Supabase, Stripe (key permissions, all 5
prices, checkout creation, webhook) and the AI (key, model, web search) are all set up.

### 9. Test a real purchase
Buy the Starter pack (€5) on your site. You should go to Stripe's checkout page, come back to the
confirmation page and receipt with +30 credits and the Starter badge. Refund it in Stripe afterwards.

---

## What's in the app

**Sign-in.** Google (OAuth through Supabase, PKCE) and passwordless email sign-in links. New accounts get
15 free credits. Sessions are kept and refreshed by Supabase. There is no password login; that isn't
part of this app's design.

**Searches.** `POST /api/mine-reviews` (also `/api/analyze-reviews`): credit check → per-user AI limits →
Firecrawl reads the page (optional) → Claude researches reviews with web search and returns JSON
(`server/engine.ts`) → converted to the dashboard's report → saved → 1.5 credits charged. Up to 5 links per
message, compared side by side. Follow-up questions: `POST /api/ask` (1.5 credits). Failed searches are
never charged. Every AI request is logged in `ai_usage` (tokens, web searches, outcome).

**Payments.** Stripe Checkout with the 5 live price IDs; credits added only after verification, exactly
once; success page with receipt (`/checkout/success`), cancellation page (`/checkout/cancelled`) that closes
the Stripe checkout. Details in `STRIPE_SETUP.md`.

**Vouchers and tiers.** Codes like `RM-XXXX-XXXX` and `APEX-1000-XXXX-XXXX` add credits and can unlock a tier
(Free → Starter → Core → Pro → Elite → Apex; tiers only go up). Guessing is blocked: 10 wrong codes per
account and 30 per connection per hour. Generate more with `supabase/migrations/014_generate_100_apex_codes.sql`.

**Admin (`/admin`).** Overview (revenue, users, AI usage and tokens), Users & credits (search, balance,
history, orders, add/remove credits with a note, change tier), Payments, Transactions (all credit movements),
System check.

**Legal.** `/privacy` and `/terms`.

## API endpoints (`functions/api/`)
All are `POST`, require a signed-in user's Supabase token (`Authorization: Bearer …`) except the webhook,
and take the account from that token, never from the request body.

| Endpoint | Purpose |
|---|---|
| `mine-reviews`, `analyze-reviews` | Analyse a product (1.5 credits) |
| `ask` | Follow-up question (1.5 credits) |
| `redeem` | Redeem a voucher code |
| `me` | Is this user an admin? |
| `my-orders` | The user's orders and receipts |
| `payments/create` | Create a Stripe Checkout Session; returns its URL |
| `verify-payment` | Ask Stripe if an order was paid; add credits once |
| `payments/cancel` | Close an unpaid checkout |
| `stripe-webhook` | Stripe's signed notifications (no user token; Stripe signature instead) |
| `admin/stats`, `admin/users`, `admin/user`, `admin/adjust-credits`, `admin/set-tier`, `admin/transactions`, `admin/orders`, `admin/health` | Admin only (checked on the server against `app_admins`) |

## Security
- Secret keys (Stripe, Supabase service_role, Anthropic, Firecrawl) are only read by `functions/` on the
  server; nothing in `src/` references them.
- Row Level Security on every table: users read only their own profile, chats, ledger and usage; they can't
  change credits or tiers, read voucher codes, payments, orders or the admin list, or call the credit,
  payment or admin functions. Those run only on the server with the service_role key.
- Stripe webhooks are verified (HMAC-SHA256 signature, max 5 minutes old). Payments are verified with
  Stripe server-side and checked against Supabase's own price list before credits are added.
- Security headers for the website are in `public/_headers`.

## Database (`supabase/migrations/`)
`000_SETUP_ALL.sql` = everything below, in order. The numbered files are kept for reference.
001 core tables, RLS and sign-up trigger · 002 settings · 003 decimal credits · 004–006 credits and grouped
chats · 007–008 vouchers · 009–013 orders, payments, verification, tiers · 014 Apex vouchers ·
015–016 Stripe Checkout · 017 usage tracking, AI limits, admin tools, checkout cancellation.

## Local development
```bash
npm install
cp .env.example .env.local   # fill in the VITE_ values
npm run dev                  # website only (API calls need the functions, below)
npm run build && npx wrangler pages dev dist   # website + functions; put server secrets in .dev.vars
```
`npm run build` type-checks the website and all functions, then builds into `dist/`.
