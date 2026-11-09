import { supabase } from './supabase';
import type {
  AdminAdjustCreditsRequest,
  AdminOrdersResponse,
  AdminSetTierRequest,
  AdminStatsResponse,
  AdminTransactionsResponse,
  AdminUserDetailResponse,
  AdminUsersRequest,
  AdminUsersResponse,
  ApiErrorBody,
  AskRequest,
  AskResponse,
  HealthResponse,
  CancelCheckoutResponse,
  CheckoutStartRequest,
  CheckoutStartResponse,
  CheckoutStatusResponse,
  MeResponse,
  MineRequest,
  MineResponse,
  MyOrdersResponse,
  OrderIdRequest,
  RedeemRequest,
  RedeemResponse,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', 'Something unexpected happened. Please try again.');
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');

  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Couldn’t reach the server. Check your internet connection and try again.');
  }

  const payload = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok || !payload) {
    const e = payload?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'ERROR',
      e?.message ?? `The server didn’t respond properly (error ${res.status}). Please try again.`,
    );
  }
  return payload;
}

export const api = {
  mine: (body: MineRequest) => post<MineResponse>('/api/mine-reviews', body),
  ask: (body: AskRequest) => post<AskResponse>('/api/ask', body),
  redeem: (body: RedeemRequest) => post<RedeemResponse>('/api/redeem', body),
  me: () => post<MeResponse>('/api/me', {}),
  createPayment: (body: CheckoutStartRequest) => post<CheckoutStartResponse>('/api/payments/create', body),
  verifyPayment: (body: OrderIdRequest) => post<CheckoutStatusResponse>('/api/verify-payment', body),
  cancelPayment: (body: OrderIdRequest) => post<CancelCheckoutResponse>('/api/payments/cancel', body),
  myOrders: () => post<MyOrdersResponse>('/api/my-orders', {}),
  adminOrders: () => post<AdminOrdersResponse>('/api/admin/orders', {}),
  adminStats: () => post<AdminStatsResponse>('/api/admin/stats', {}),
  adminUsers: (body: AdminUsersRequest) => post<AdminUsersResponse>('/api/admin/users', body),
  adminUser: (body: { userId: string }) => post<AdminUserDetailResponse>('/api/admin/user', body),
  adminAdjustCredits: (body: AdminAdjustCreditsRequest) => post<{ ok: true; newBalance: number }>('/api/admin/adjust-credits', body),
  adminSetTier: (body: AdminSetTierRequest) => post<{ ok: true; tier: string }>('/api/admin/set-tier', body),
  adminTransactions: (body: { reason?: string }) => post<AdminTransactionsResponse>('/api/admin/transactions', body),
  adminHealth: () => post<HealthResponse>('/api/admin/health', {}),
};
