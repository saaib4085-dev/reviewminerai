import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminOrder, OrderStatus, PackId, VoucherOrder } from '../shared/types';
import { HttpError } from './http';

export const ORDER_COLUMNS =
  'id, user_id, pack, credits, amount_cents, currency, reference, status, payment_method, gift, created_at, paid_at, amount_received_cents, payment_method_label, payer_name, receipt_number, payment_intent_id, failure_message, promo_codes(code, redeemed)';

interface OrderRow {
  id: string;
  user_id: string;
  pack: PackId;
  credits: number;
  amount_cents: number;
  currency: string;
  reference: string | null;
  status: OrderStatus;
  payment_method: VoucherOrder['paymentMethod'];
  gift: boolean;
  created_at: string;
  paid_at: string | null;
  amount_received_cents: number | null;
  payment_method_label: string | null;
  payer_name: string | null;
  receipt_number: string | null;
  payment_intent_id: string | null;
  failure_message: string | null;
  promo_codes: { code: string; redeemed: boolean } | { code: string; redeemed: boolean }[] | null;
}

export function toOrder(raw: unknown): VoucherOrder {
  const r = raw as OrderRow;
  const pc = Array.isArray(r.promo_codes) ? r.promo_codes[0] : r.promo_codes;
  const paid = r.status === 'paid' && !!pc;
  return {
    id: r.id,
    pack: r.pack,
    credits: r.credits,
    amountCents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    paymentMethod: r.payment_method,
    gift: r.gift,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    methodLabel: r.payment_method_label,
    payerName: r.payer_name,
    receiptNumber: r.receipt_number,
    paymentReference: r.payment_intent_id ?? r.reference,
    failureMessage: r.failure_message,
    code: paid ? pc.code : null,
    redeemed: paid ? pc.redeemed : null,
  };
}

export function toAdminOrder(raw: unknown, emails: Map<string, string>): AdminOrder {
  const r = raw as OrderRow;
  return { ...toOrder(raw), buyerEmail: emails.get(r.user_id) ?? null, amountReceivedCents: r.amount_received_cents };
}

export async function isAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function requireAdmin(db: SupabaseClient, userId: string): Promise<void> {
  if (!(await isAdmin(db, userId))) throw new HttpError(403, 'NOT_ADMIN', 'Only the site owner can do this.');
}

export function parseOrderId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Missing order.');
  }
  return value;
}
