import type { SupabaseClient } from '@supabase/supabase-js';
import { describePayment, type StripePaymentIntent } from './stripe';

/** Saves what Stripe says about a payment in Supabase's `payments` table. */
export async function recordPayment(db: SupabaseClient, pi: StripePaymentIntent, source: 'stripe_webhook' | 'stripe_api', eventId?: string) {
  const userId = pi.metadata?.user_id;
  const { error } = await db.rpc('record_stripe_payment', {
    p_payment_intent_id: pi.id,
    p_user_id: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
    p_pack: pi.metadata?.pack ?? null,
    p_amount_cents: pi.amount,
    p_amount_received_cents: pi.amount_received ?? 0,
    p_currency: pi.currency,
    p_status: pi.status,
    p_source: source,
    p_event_id: eventId ?? null,
  });
  if (error) throw error;
}

/**
 * Brings the order in Supabase up to date with the payment:
 *  succeeded  → Supabase verifies it, creates the code and (unless it's a gift) adds the credits
 *  processing → marked as being confirmed (SEPA Direct Debit takes a few days)
 *  failed     → marked as failed with the reason
 * Returns the buyer's new balance if credits were just added.
 */
export async function syncOrder(db: SupabaseClient, pi: StripePaymentIntent): Promise<{ newCredits: number | null }> {
  const { label, payer } = describePayment(pi);

  // With Stripe's hosted checkout, the payment is created on Stripe's page, so link it to its order.
  const orderId = pi.metadata?.order_id;
  if (orderId && /^[0-9a-f-]{36}$/i.test(orderId)) {
    const { error: linkError } = await db
      .from('voucher_orders')
      .update({ payment_intent_id: pi.id })
      .eq('id', orderId)
      .is('payment_intent_id', null);
    if (linkError) throw linkError;
  }

  if (pi.status === 'succeeded') {
    const { data, error } = await db.rpc('fulfill_stripe_order', {
      p_payment_intent_id: pi.id,
      p_method_label: label,
      p_payer_name: payer,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { status: string; new_balance: number | string | null; newly_fulfilled: boolean } | null;
    if (row?.status !== 'ok') {
      console.error('Supabase refused to fulfil order', pi.id, row?.status);
      return { newCredits: null };
    }
    return { newCredits: row.newly_fulfilled && row.new_balance !== null ? Number(row.new_balance) : null };
  }

  const failed = pi.status === 'canceled' || (pi.status === 'requires_payment_method' && !!pi.last_payment_error);
  const status = pi.status === 'processing' ? 'processing' : failed ? 'failed' : null;
  if (status) {
    const { error } = await db
      .from('voucher_orders')
      .update({
        status,
        payment_method_label: label,
        payer_name: payer,
        failure_message: failed ? (pi.last_payment_error?.message ?? 'The payment was cancelled.') : null,
      })
      .eq('payment_intent_id', pi.id)
      .neq('status', 'paid');
    if (error) throw error;
  }
  return { newCredits: null };
}
