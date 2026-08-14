import type { ListLoansOptions } from '../types';
import { encodePathSegment, type ZolvoClient } from './client';

export async function listLoans(
  client: ZolvoClient,
  options: ListLoansOptions = {},
): Promise<Record<string, unknown>> {
  return client.get<Record<string, unknown>>('/loans', options);
}

export async function getLoan(
  client: ZolvoClient,
  loanId: string,
): Promise<Record<string, unknown>> {
  return client.get<Record<string, unknown>>(`/loans/${encodePathSegment(loanId)}`);
}
