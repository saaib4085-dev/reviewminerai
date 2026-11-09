import { CREDIT_PACKS, formatPrice, type VoucherOrder } from '../../shared/types';
import { SITE } from '../lib/siteInfo';

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'text-[15px] font-semibold text-slate-900' : 'text-[13px] text-slate-700'}`}>
      <span>{label}</span>
      <span className="text-right font-mono">{value}</span>
    </div>
  );
}

const Divider = () => <div className="my-4 border-t border-dashed border-slate-300" />;

/** A paper-style receipt: high contrast so it photographs and prints well. */
export default function Receipt({ order }: { order: VoucherOrder }) {
  const pack = CREDIT_PACKS[order.pack];
  const paid = order.paidAt ? new Date(order.paidAt) : null;
  const date = paid
    ? paid.toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const amount = formatPrice(order.amountCents / 100);

  return (
    <div className="print-area mx-auto w-full max-w-sm">
      <div
        className="relative rounded-t-2xl bg-white px-6 pb-8 pt-6 text-slate-800 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
        style={{
          WebkitMaskImage: 'radial-gradient(circle at 10px 100%, transparent 7px, #000 7.5px)',
          WebkitMaskSize: '20px 100%',
          WebkitMaskPosition: 'bottom',
          maskImage: 'radial-gradient(circle at 10px 100%, transparent 7px, #000 7.5px)',
          maskSize: '20px 100%',
          maskPosition: 'bottom',
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold tracking-tight text-slate-900">{SITE.appName}</p>
            <p className="text-[12px] text-slate-500">{SITE.operator !== SITE.appName ? SITE.operator : SITE.contactEmail}</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">✓ Paid</span>
        </div>

        <p className="mt-5 text-[12px] uppercase tracking-[0.18em] text-slate-500">Payment receipt</p>
        <p className="font-mono text-xl font-semibold tracking-wide text-slate-900">{order.receiptNumber ?? '—'}</p>
        <p className="text-[13px] text-slate-600">{date}</p>

        <Divider />
        <Line label={`${pack?.name ?? order.pack} pack · ${order.credits.toLocaleString()} credits`} value={amount} />
        <div className="mt-2">
          <Line label="Total paid" value={amount} strong />
        </div>

        <Divider />
        <div className="space-y-1.5">
          <Line label="Paid with" value={order.methodLabel ?? 'Card'} />
          {order.payerName && <Line label="Name" value={order.payerName} />}
        </div>

        <Divider />
        {order.gift ? (
          <div className="rounded-xl bg-slate-100 p-4 text-center">
            <p className="text-[12px] text-slate-500">Voucher code · {order.credits.toLocaleString()} credits</p>
            <p className="mt-1 select-all font-mono text-2xl font-bold tracking-[0.12em] text-slate-900">{order.code}</p>
            <p className="mt-1 text-[12px] text-slate-500">Works once, on any account. {order.redeemed ? 'Already used.' : 'Not used yet.'}</p>
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-50 p-4 text-center">
            <p className="text-[15px] font-semibold text-emerald-800">{order.credits.toLocaleString()} credits added to your account</p>
          </div>
        )}

        <Divider />
        <p className="break-all font-mono text-[11px] text-slate-500">Payment ID {order.paymentReference ?? '—'}</p>
        <p className="mt-3 text-center text-[12px] text-slate-500">Thank you for your purchase.</p>
      </div>
    </div>
  );
}
