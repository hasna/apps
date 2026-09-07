import { enumerateSelfHostedRows } from "../../db/self-hosted-page.js";
import {
  diagnoseInboundDelivery,
  diagnoseInboundDeliveryLive,
  type DeliveryDoctorReport,
} from "../../lib/delivery-doctor.js";
import { canonicalSender } from "../../lib/email-address.js";
import { resolveMailDataSource } from "../../lib/mail-data-source.js";

/** Only public diagnostic metadata; never echo source settings or provider snapshots. */
export function apiIngestionStatus() {
  const scan = enumerateSelfHostedRows("sources");
  return {
    sources: scan.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? row.id),
      type: String(row.type ?? "unknown"),
      status: String(row.status ?? "unknown"),
      last_synced_at:
        row.last_synced_at == null ? null : String(row.last_synced_at),
    })),
    complete: scan.complete,
    worker_health: {
      status: "unknown" as const,
      reason:
        "The API exposes registered source state and last-sync timestamps, but does not expose a worker heartbeat or queue health check.",
    },
  };
}

export function formatApiIngestionStatus(
  status: ReturnType<typeof apiIngestionStatus>,
): string {
  return [
    `${status.complete ? "" : "At least "}${status.sources.length} registered ingestion source(s)`,
    ...status.sources.map(
      (source) =>
        `  ${source.name} (${source.type}): ${source.status}; last sync ${source.last_synced_at ?? "not reported"}`,
    ),
    `Worker health: ${status.worker_health.status}. ${status.worker_health.reason}`,
  ].join("\n");
}

export async function apiDeliveryDiagnosis(
  address: string,
  options: {
    live?: boolean;
    ingestion?: ReturnType<typeof apiIngestionStatus>;
  } = {},
): Promise<DeliveryDoctorReport> {
  const report = await (options.live
    ? diagnoseInboundDeliveryLive(address)
    : diagnoseInboundDelivery(address));
  const ingestion = options.ingestion ?? apiIngestionStatus();
  // Client config has no authority over API worker configuration. Replace the
  // legacy local-S3 checks with the facts published by the selected service.
  report.checks = report.checks.filter(
    (check) => check.name !== "Inbound sources" && check.name !== "Realtime",
  );
  report.checks.push(
    {
      name: "Inbound sources",
      status: ingestion.sources.length > 0 ? "pass" : "warn",
      message: `${ingestion.complete ? "" : "At least "}${ingestion.sources.length} registered ingestion source(s) in the API. Registration is not proof of a healthy running worker.`,
    },
    {
      name: "Realtime",
      status: "warn",
      message: ingestion.worker_health.reason,
    },
  );
  for (const check of report.checks)
    if (check.name === "Recent local mail") check.name = "Recent mail";
  return report;
}

export async function explainApiMessage(identifier: string) {
  const ds = resolveMailDataSource();
  const id = await ds.resolveId(identifier);
  const message = await ds.getMessage(id);
  if (!message) throw new Error(`Email not found: ${identifier}`);
  const recipients = [
    ...new Set(
      [message.to, message.cc ?? ""]
        .flatMap((value) => value.split(","))
        .map((value) => canonicalSender(value) ?? value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (recipients.length > 100)
    throw new Error(
      "Message has more than 100 recipients; use doctor delivery for individual addresses",
    );
  const ingestion = apiIngestionStatus();
  const reports: DeliveryDoctorReport[] = [];
  // Sequential, bounded reads avoid multiplying registry request pressure.
  for (const recipient of recipients)
    reports.push(await apiDeliveryDiagnosis(recipient, { ingestion }));
  return { email_id: message.id, direction: message.sentByMe ? "outbound" : "inbound", recipients: reports };
}
