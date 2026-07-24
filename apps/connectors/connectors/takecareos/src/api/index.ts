import { TakeCareOSClientTransport, type RequestOptions } from "./client";
import type {
  TakeCareOSConfig,
  TakeCareOSClient,
  TakeCareOSCaregiver,
  TakeCareOSShift,
  CreateShiftInput,
  TakeCareOSIncident,
  CreateIncidentInput,
  TakeCareOSInvoice,
  TakeCareOSComplianceReport,
  TakeCareOSList,
} from "../types/index";

export { TakeCareOSClientTransport } from "./client";
export type { RequestOptions } from "./client";

export interface ListOptions {
  page?: number;
  perPage?: number;
  status?: string;
}

/**
 * Main TakeCareOS connector — home-care agency operations over the public API.
 *
 * Wraps the raw transport with typed operations for clients, caregivers, shifts,
 * incidents, invoices and compliance reporting. Use `rawRequest` for endpoints
 * that are not yet modelled here.
 */
export class TakeCareOS {
  private readonly client: TakeCareOSClientTransport;

  constructor(config: TakeCareOSConfig) {
    this.client = new TakeCareOSClientTransport(config);
  }

  static fromEnv(): TakeCareOS {
    const apiKey = process.env.TAKECAREOS_API_KEY;
    const baseUrl = process.env.TAKECAREOS_BASE_URL;
    if (!apiKey) {
      throw new Error("TAKECAREOS_API_KEY environment variable is required");
    }
    return new TakeCareOS({ apiKey, baseUrl });
  }

  // ── Clients ───────────────────────────────────────────────
  async listClients(options: ListOptions = {}): Promise<TakeCareOSList<TakeCareOSClient>> {
    return this.client.request<TakeCareOSList<TakeCareOSClient>>("/clients", {
      params: { page: options.page, per_page: options.perPage, status: options.status },
    });
  }

  async getClient(clientId: string): Promise<TakeCareOSClient> {
    return this.client.request<TakeCareOSClient>(`/clients/${encodeURIComponent(clientId)}`);
  }

  // ── Caregivers ────────────────────────────────────────────
  async listCaregivers(options: ListOptions = {}): Promise<TakeCareOSList<TakeCareOSCaregiver>> {
    return this.client.request<TakeCareOSList<TakeCareOSCaregiver>>("/caregivers", {
      params: { page: options.page, per_page: options.perPage, status: options.status },
    });
  }

  // ── Shifts ────────────────────────────────────────────────
  async listShifts(
    options: ListOptions & { clientId?: string; caregiverId?: string; from?: string; to?: string } = {},
  ): Promise<TakeCareOSList<TakeCareOSShift>> {
    return this.client.request<TakeCareOSList<TakeCareOSShift>>("/shifts", {
      params: {
        page: options.page,
        per_page: options.perPage,
        status: options.status,
        client_id: options.clientId,
        caregiver_id: options.caregiverId,
        from: options.from,
        to: options.to,
      },
    });
  }

  async createShift(input: CreateShiftInput): Promise<TakeCareOSShift> {
    return this.client.request<TakeCareOSShift>("/shifts", { method: "POST", body: input });
  }

  // ── Incidents ─────────────────────────────────────────────
  async listIncidents(
    options: ListOptions & { clientId?: string; severity?: string } = {},
  ): Promise<TakeCareOSList<TakeCareOSIncident>> {
    return this.client.request<TakeCareOSList<TakeCareOSIncident>>("/incidents", {
      params: {
        page: options.page,
        per_page: options.perPage,
        status: options.status,
        client_id: options.clientId,
        severity: options.severity,
      },
    });
  }

  async createIncident(input: CreateIncidentInput): Promise<TakeCareOSIncident> {
    return this.client.request<TakeCareOSIncident>("/incidents", { method: "POST", body: input });
  }

  // ── Invoices ──────────────────────────────────────────────
  async listInvoices(
    options: ListOptions & { clientId?: string } = {},
  ): Promise<TakeCareOSList<TakeCareOSInvoice>> {
    return this.client.request<TakeCareOSList<TakeCareOSInvoice>>("/invoices", {
      params: {
        page: options.page,
        per_page: options.perPage,
        status: options.status,
        client_id: options.clientId,
      },
    });
  }

  // ── Compliance ────────────────────────────────────────────
  async getComplianceReport(options: { from?: string; to?: string } = {}): Promise<TakeCareOSComplianceReport> {
    return this.client.request<TakeCareOSComplianceReport>("/compliance/report", {
      params: { from: options.from, to: options.to },
    });
  }

  /** Escape hatch for endpoints not yet modelled by a typed method. */
  async rawRequest<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }

  /** Access the underlying transport (base URL, low-level request). */
  getTransport(): TakeCareOSClientTransport {
    return this.client;
  }
}
