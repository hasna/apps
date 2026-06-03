import type { Domain, DomainStatus } from "../../db/domains.js";

export const TABLE_COLS = {
  name: 28,
  status: 14,
  expires: 12,
  registrar: 16,
} as const;

export function pad(value: string, width: number): string {
  if (value.length > width) return value.slice(0, width - 1) + "…";
  return value.padEnd(width);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function daysUntil(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return "expired";
  if (days === 0) return "today";
  return `${days}d`;
}

export const STATUS_COLORS: Record<DomainStatus, string> = {
  discovered: "gray",
  researching: "blue",
  offered: "yellow",
  negotiating: "yellow",
  purchased: "green",
  active: "green",
  not_available: "red",
  premium_only: "magenta",
  declined: "red",
  expired: "red",
  transferring: "cyan",
  redemption: "red",
};

export function domainRowLabel(domain: Domain): string {
  return `${pad(domain.name, TABLE_COLS.name)}${pad(domain.status, TABLE_COLS.status)}${pad(formatDate(domain.expires_at), TABLE_COLS.expires)}${pad(domain.registrar ?? "—", TABLE_COLS.registrar)}`;
}

export function stripAnsi(value: string | undefined): string {
  return (value ?? "").replace(/\u001B\[[0-9;]*m/g, "");
}

export type DomainFilter = "all" | "active" | "expiring" | "premium";

export const DOMAIN_FILTERS: DomainFilter[] = ["all", "active", "expiring", "premium"];

export function filterLabel(filter: DomainFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "active":
      return "Active";
    case "expiring":
      return "Expiring (30d)";
    case "premium":
      return "Premium";
  }
}
