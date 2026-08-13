import { z } from "zod";
import type {
  AccountingReconciliationRow,
  CustomerRow,
  DunningRunRow,
  EventRow,
  InvoiceRow,
  SubscriptionRow,
} from "../types/index.js";
import { CustomerNotFoundError } from "../types/index.js";
import { assertEntity, type ServiceOp } from "./context.js";

const supportInput = z.object({ customer_id: z.string().min(1) });

export const supportOps: ServiceOp[] = [
  {
    op: "get_support_customer_snapshot",
    resource: "support",
    summary: "Operator/customer-support snapshot: customer, subscriptions, invoices, dunning, webhooks, and reconciliation status.",
    action: "read",
    scopes: ["billing:read"],
    mutates: false,
    method: "GET",
    path: "/v1/support/customers/:customer_id",
    input: supportInput,
    profiles: ["standard", "full"],
    handler: (ctx, raw) => {
      const { customer_id } = raw as z.infer<typeof supportInput>;
      const customer = ctx.db.query("SELECT * FROM customers WHERE id = ?").get(customer_id) as CustomerRow | null;
      if (!customer) throw new CustomerNotFoundError(`Customer ${customer_id} not found.`);
      assertEntity(ctx, "read", customer.entity_id, "support");
      const subscriptions = ctx.db
        .query("SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY created_at")
        .all(customer.id) as SubscriptionRow[];
      const invoices = ctx.db
        .query("SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at")
        .all(customer.id) as InvoiceRow[];
      const invoiceIds = invoices.map((i) => i.id);
      const dunningRuns =
        invoiceIds.length === 0
          ? []
          : (ctx.db
              .query(`SELECT * FROM dunning_runs WHERE invoice_id IN (${invoiceIds.map(() => "?").join(",")}) ORDER BY created_at`)
              .all(...invoiceIds) as DunningRunRow[]);
      const events = ctx.db
        .query("SELECT * FROM events WHERE entity_id = ? ORDER BY received_at DESC LIMIT 20")
        .all(customer.entity_id) as EventRow[];
      const reconciliation = ctx.db
        .query("SELECT * FROM accounting_reconciliation_events WHERE entity_id = ? ORDER BY created_at DESC LIMIT 50")
        .all(customer.entity_id) as AccountingReconciliationRow[];
      return {
        customer,
        subscriptions,
        invoices,
        dunning_runs: dunningRuns,
        webhook_events: events,
        accounting_reconciliation: reconciliation,
        customer_portal: {
          handoff_available: customer.stripe_customer_id !== null,
          stripe_customer_id: customer.stripe_customer_id,
        },
      };
    },
  },
];
