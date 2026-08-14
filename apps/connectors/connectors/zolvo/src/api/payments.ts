import type { ListPaymentsOptions, ReconcilePaymentRequest } from '../types';
import { encodePathSegment, type ZolvoClient } from './client';

export async function listPayments(
  client: ZolvoClient,
  options: ListPaymentsOptions = {},
): Promise<Record<string, unknown>> {
  return client.get<Record<string, unknown>>('/payments', options);
}

export async function reconcilePayment(
  client: ZolvoClient,
  paymentId: string,
  body: ReconcilePaymentRequest = {},
): Promise<Record<string, unknown>> {
  return client.post<Record<string, unknown>>(
    `/payments/${encodePathSegment(paymentId)}/reconcile`,
    body,
  );
}
