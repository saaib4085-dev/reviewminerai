// POST /api/admin/health  → one-click system check for the site owner (admins only).
// Tests the real setup from the server, with your real keys: Supabase tables, Stripe key
// permissions, pack prices, payment methods, webhook, Anthropic and Firecrawl.
// Side effect: creates one Starter checkout page and closes it straight away (nobody is charged),
// to prove the key can open checkout pages.

import type { Env } from '../../../server/env';
import { handleError, json, requireEnv } from '../../../server/http';
import { requireUser, serviceClient } from '../../../server/supabase';
import { requireAdmin } from '../../../server/orders';
import { priceIdFor } from '../../../server/stripe';
import { CREDIT_PACKS, PACK_ORDER, formatPrice, type HealthCheck, type HealthResponse } from '../../../shared/types';
import { timeAgoServer } from '../../../server/time';
import { DEFAULT_MODEL } from '../../../server/claude';


async function stripeRaw(env: Env, path: string, method: 'GET' | 'POST' = 'GET', body?: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  return { status: res.status, data };
}

const permissionHint = (status: number, needed: string) =>
  status === 401 ? 'The key is wrong or was deleted. Create a new one and update STRIPE_SECRET_KEY.'
  : status === 403 ? `The key is missing the “${needed}” permission. Edit the restricted key in Stripe and turn it on.`
  : `Stripe answered with error ${status}.`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    requireEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    const db = serviceClient(env);
    const user = await requireUser(request, db);
    await requireAdmin(db, user.id);

    const checks: HealthCheck[] = [];
    const add = (group: HealthCheck['group'], label: string, status: HealthCheck['status'], detail: string) =>
      checks.push({ group, label, status, detail });

    // ---------------- Supabase ----------------
    add('Supabase', 'Connection and admin access', 'ok', 'Connected, and you are an admin.');

    const probes: [string, string, () => PromiseLike<{ error: { message: string } | null }>][] = [
      ['Payments tables', '010_payment_verification_and_terms.sql', () => db.from('payments').select('id').limit(1)],
      ['Card checkout', '012_stripe_checkout.sql', () => db.from('voucher_orders').select('gift, receipt_number').limit(1)],
      ['Tiers', '013_tiers.sql', () => db.from('profiles').select('tier').limit(1)],
    ];
    for (const [label, file, run] of probes) {
      const { error } = await run();
      add('Supabase', label, error ? 'fail' : 'ok', error ? `Missing. Run ${file} in the Supabase SQL Editor.` : 'Set up.');
    }

    const { data: packs, error: packsError } = await db.from('credit_packs').select('pack, credits, price_cents, currency, active');
    const dbPacks = new Map((packs ?? []).map((p) => [p.pack as string, p as { credits: number; price_cents: number; currency: string; active: boolean }]));
    if (packsError) {
      add('Supabase', 'Price list (credit_packs)', 'fail', 'Missing. Run 010_payment_verification_and_terms.sql.');
    } else {
      const wrong = PACK_ORDER.filter((id) => {
        const p = dbPacks.get(id);
        return !p || !p.active || p.credits !== CREDIT_PACKS[id].credits || p.price_cents !== CREDIT_PACKS[id].price * 100;
      });
      add(
        'Supabase',
        'Price list (credit_packs)',
        wrong.length ? 'fail' : 'ok',
        wrong.length ? `Doesn’t match the website for: ${wrong.map((w) => CREDIT_PACKS[w].name).join(', ')}.` : 'All 5 packs match the website.',
      );
    }

    const { count: apexLeft } = await db
      .from('promo_codes')
      .select('id', { count: 'exact', head: true })
      .eq('tier', 'Apex')
      .eq('redeemed', false)
      .like('code', 'APEX-1000-%');
    add('Supabase', 'Unused Apex vouchers', 'ok', `${apexLeft ?? 0} unused APEX-1000 codes.`);

    // ---------------- Stripe ----------------
    let stripeMode: HealthResponse['stripeMode'] = null;
    const key = env.STRIPE_SECRET_KEY ?? '';
    if (!key) {
      add('Stripe', 'Secret key', 'fail', 'STRIPE_SECRET_KEY is not set in Cloudflare.');
    } else {
      stripeMode = /_live_/.test(key) ? 'live' : /_test_/.test(key) ? 'test' : null;
      add(
        'Stripe',
        'Secret key',
        stripeMode === 'live' ? 'ok' : 'warn',
        stripeMode === 'live' ? 'Live key: real payments.' : stripeMode === 'test' ? 'Test key: no real money will be taken.' : 'Unrecognised key format.',
      );

      // Prices: Read + each pack matches
      let priceProblem = false;
      for (const id of PACK_ORDER) {
        const pack = CREDIT_PACKS[id];
        const priceId = priceIdFor(env, id);
        const { status, data } = await stripeRaw(env, `prices/${priceId}`);
        if (status !== 200) {
          add(
            'Stripe',
            `${pack.name} price`,
            'fail',
            status === 404
              ? stripeMode === 'test' && priceId === pack.stripePriceId
                ? `You're using a test key, but ${priceId} is a live price. Create the pack in Stripe's test mode and set STRIPE_PRICE_${id.toUpperCase()} to its test price ID.`
                : `Price ${priceId} not found. Is it from the same Stripe account and mode (test/live) as the key?`
              : permissionHint(status, 'Prices: Read'),
          );
          priceProblem = true;
          continue;
        }
        const amount = data.unit_amount as number | null;
        const ok = data.active === true && data.currency === 'eur' && amount === pack.price * 100;
        if (!ok) priceProblem = true;
        add(
          'Stripe',
          `${pack.name} price`,
          ok ? 'ok' : 'fail',
          ok
            ? `${formatPrice(pack.price)}, active.`
            : `Stripe has ${amount === null ? 'no amount' : formatPrice(amount / 100)} ${String(data.currency).toUpperCase()}${data.active ? '' : ', archived'}; the website sells it for ${formatPrice(pack.price)}. This pack is paused until they match.`,
        );
      }
      void priceProblem;

      // Checkout Sessions: Write (create a Starter checkout page, then expire it straight away)
      const body = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price]': priceIdFor(env, 'starter'),
        'line_items[0][quantity]': '1',
        success_url: 'https://example.com/?system_check=1',
        cancel_url: 'https://example.com/?system_check=1',
        'metadata[kind]': 'health_check',
        'consent_collection[terms_of_service]': 'required',
      });
      let created = await stripeRaw(env, 'checkout/sessions', 'POST', body);
      if (created.status === 400 && /terms of service/i.test(String(created.data.error?.message ?? ''))) {
        add(
          'Stripe',
          'Terms checkbox on Stripe’s page',
          'warn',
          'Add your Terms URL (https://YOUR-SITE/terms) in Stripe → Settings → Public details. Until then the Terms show as a note above the Pay button instead of a required checkbox.',
        );
        body.delete('consent_collection[terms_of_service]');
        created = await stripeRaw(env, 'checkout/sessions', 'POST', body);
      } else if (created.status === 200) {
        add('Stripe', 'Terms checkbox on Stripe’s page', 'ok', 'Buyers must tick “I agree to the Terms” on Stripe’s page.');
      }
      if (created.status !== 200) {
        add('Stripe', 'Can open checkout pages', 'fail', permissionHint(created.status, 'Checkout Sessions: Write'));
      } else {
        const methods = (created.data.payment_method_types as string[] | undefined) ?? [];
        await stripeRaw(env, `checkout/sessions/${created.data.id as string}/expire`, 'POST', new URLSearchParams());
        add('Stripe', 'Can open checkout pages', 'ok', 'Yes (a test checkout page was created and closed straight away; nobody was charged).');
        const names: Record<string, string> = { card: 'Cards (incl. Apple Pay & Google Pay)', sepa_debit: 'SEPA Direct Debit' };
        add(
          'Stripe',
          'Payment methods switched on',
          methods.length === 0 || methods.includes('card') ? 'ok' : 'warn',
          methods.length
            ? `${methods.map((m) => names[m] ?? m).join(', ')}.`
            : 'Chosen automatically by Stripe from your Settings → Payment methods.',
        );
      }

      // PaymentIntents: Read (needed to confirm each payment)
      const pis = await stripeRaw(env, 'payment_intents?limit=1');
      add(
        'Stripe',
        'Can confirm payments',
        pis.status === 200 ? 'ok' : 'fail',
        pis.status === 200 ? 'Yes.' : permissionHint(pis.status, 'PaymentIntents: Read'),
      );

      // Charges: Read (needed for the receipt's card / IBAN details)
      const charges = await stripeRaw(env, 'charges?limit=1');
      add(
        'Stripe',
        'Can read payment details for receipts',
        charges.status === 200 ? 'ok' : 'warn',
        charges.status === 200 ? 'Yes.' : `${permissionHint(charges.status, 'Charges: Read')} Receipts would show “Card” instead of e.g. “Visa •••• 4242”.`,
      );
    }

    // Webhook
    const whsec = env.STRIPE_WEBHOOK_SECRET ?? '';
    add(
      'Stripe',
      'Webhook signing secret',
      whsec.startsWith('whsec_') ? 'ok' : 'fail',
      whsec.startsWith('whsec_') ? 'Set.' : 'STRIPE_WEBHOOK_SECRET is missing or doesn’t start with whsec_. SEPA payments won’t finish without it.',
    );
    const { data: lastHook } = await db
      .from('payments')
      .select('created_at, updated_at')
      .eq('verified_by', 'stripe_webhook')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    add(
      'Stripe',
      'Last webhook received',
      lastHook ? 'ok' : 'warn',
      lastHook
        ? `${timeAgoServer(lastHook.updated_at as string)}.`
        : 'None yet. That’s normal before your first sale. After a test purchase this should change; if not, check the endpoint URL and events in Stripe → Webhooks.',
    );

    // ---------------- AI ----------------
    const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    if (!env.ANTHROPIC_API_KEY) {
      add('AI', 'Anthropic key', 'fail', 'ANTHROPIC_API_KEY is not set, so searches are switched off.');
    } else {
      try {
        const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        });
        if (res.status === 401 || res.status === 403) {
          add('AI', 'Anthropic key', 'fail', 'The key was rejected. Create a new one at console.anthropic.com and update ANTHROPIC_API_KEY.');
        } else if (!res.ok) {
          add('AI', 'Anthropic key', 'warn', `Anthropic answered with error ${res.status}. Try again in a minute.`);
        } else {
          const ids = (((await res.json()) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
          add('AI', 'Anthropic key', 'ok', 'Valid.');
          if (ids.includes(model)) {
            const info = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
              headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null) as { capabilities?: { server_tools?: { web_search?: { supported?: boolean } } } } | null;
            const ws = info?.capabilities?.server_tools?.web_search?.supported;
            add(
              'AI',
              'Web search',
              ws === false ? 'fail' : 'ok',
              ws === false
                ? `${model} doesn’t support web search. Set ANTHROPIC_MODEL to a model that does.`
                : 'Supported. Make sure web search is switched on in the Claude Console → Settings → Privacy.',
            );
          }
          add(
            'AI',
            'AI model',
            ids.includes(model) ? 'ok' : 'warn',
            ids.includes(model)
              ? `${model} is available.`
              : `${model} isn’t in your account’s model list. Set ANTHROPIC_MODEL to one of: ${ids.filter((i) => i.includes('sonnet')).slice(0, 3).join(', ') || ids.slice(0, 3).join(', ')}.`,
          );
        }
      } catch {
        add('AI', 'Anthropic key', 'warn', 'Couldn’t reach Anthropic right now. Try again in a minute.');
      }
    }
    if (!env.FIRECRAWL_API_KEY) {
      add('AI', 'Firecrawl key (reads product pages)', 'warn', 'Not set. Searches still work using web search alone; Firecrawl adds the product page itself.');
    } else {
      try {
        const res = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', { headers: { authorization: `Bearer ${env.FIRECRAWL_API_KEY}` } });
        if (res.status === 401 || res.status === 403) {
          add('AI', 'Firecrawl key (reads product pages)', 'fail', 'The key was rejected. Copy it again from firecrawl.dev and update FIRECRAWL_API_KEY.');
        } else {
          const body = (await res.json().catch(() => null)) as { data?: { remaining_credits?: number } } | null;
          const left = body?.data?.remaining_credits;
          add('AI', 'Firecrawl key (reads product pages)', 'ok', typeof left === 'number' ? `Valid, ${left.toLocaleString()} Firecrawl credits left.` : 'Set.');
        }
      } catch {
        add('AI', 'Firecrawl key (reads product pages)', 'warn', 'Couldn’t reach Firecrawl right now.');
      }
    }

    // ---------------- Settings ----------------
    const contact = (env as unknown as Record<string, string | undefined>).VITE_CONTACT_EMAIL;
    add(
      'Settings',
      'Contact email on Privacy / Terms',
      contact && !contact.includes('yourdomain') ? 'ok' : 'warn',
      contact && !contact.includes('yourdomain') ? contact : 'VITE_CONTACT_EMAIL isn’t set, so the legal pages show a placeholder email.',
    );

    const response: HealthResponse = { checks, stripeMode, checkedAt: new Date().toISOString() };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
};
