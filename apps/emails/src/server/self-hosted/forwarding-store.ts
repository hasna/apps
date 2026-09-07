import { SELF_HOSTED_SEND_ATTACHMENT_LIMITS, base64EncodedBytes } from "../../lib/send-attachment-limits.js";
import { randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import type { ForwardingBatchOptions, ForwardingClaim } from "./forwarding.js";

export async function claimForwarding(
  client: TypedQueryClient,
  tenantId: string,
  options: ForwardingBatchOptions,
): Promise<ForwardingClaim[]> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("Forwarding limit must be 1–1000");
  return client.many<ForwardingClaim>(
    `WITH candidates AS (
       SELECT r.id AS rule_id, m.id AS message_id,
         jsonb_build_object('rule', jsonb_build_object('source_address',r.source_address,'target_address',r.target_address,
           'from_address',r.from_address,'provider_id',r.provider_id,'mode',r.mode),
           'message',jsonb_build_object('from_addr',m.from_addr,'subject',m.subject,'body_text',m.body_text,'body_html',m.body_html,
             'attachments',CASE WHEN octet_length(m.attachments::text)<=$6 THEN m.attachments
               ELSE '[{"forwarding_content_oversize":true}]'::jsonb END,
             'received_at',m.received_at,'created_at',m.created_at,'headers',m.headers), 'options',$4::jsonb) AS snapshot
       FROM forwarding_rules r
       JOIN message_recipients recipient ON recipient.tenant_id=r.tenant_id AND recipient.email=lower(r.source_address)
       JOIN messages m ON m.id=recipient.message_id AND m.tenant_id=r.tenant_id
       LEFT JOIN forwarding_delivery_jobs j ON j.tenant_id=r.tenant_id AND j.rule_id=r.id AND j.message_id=m.id
       WHERE r.tenant_id=$1 AND r.enabled=true AND r.mode='app-copy'
         AND m.direction='inbound' AND ($3::boolean OR COALESCE(m.received_at,m.created_at)>=r.created_at)
         AND (j.rule_id IS NULL OR j.status='failed' OR (j.status='processing' AND j.updated_at<now()-interval '5 minutes'))
       ORDER BY COALESCE(m.received_at,m.created_at),r.id,m.id
       LIMIT $2 FOR UPDATE OF r SKIP LOCKED
     )
     INSERT INTO forwarding_delivery_jobs(tenant_id,rule_id,message_id,snapshot,status,lease)
     SELECT $1,rule_id,message_id,snapshot,'processing',$5::uuid FROM candidates
     ON CONFLICT(tenant_id,rule_id,message_id) DO UPDATE SET status='processing',lease=$5::uuid,updated_at=now(),error=NULL
       WHERE forwarding_delivery_jobs.status='failed' OR
         (forwarding_delivery_jobs.status='processing' AND forwarding_delivery_jobs.updated_at<now()-interval '5 minutes')
     RETURNING rule_id::text,message_id::text,lease::text,snapshot`,
    [
      tenantId,
      limit,
      options.backfill === true,
      JSON.stringify(options),
      randomUUID(),
      base64EncodedBytes(SELF_HOSTED_SEND_ATTACHMENT_LIMITS.maxTotalBytes) + 65536,
    ],
  );
}

export async function finishForwarding(
  client: TypedQueryClient,
  tenantId: string,
  claim: ForwardingClaim,
  status: "sent" | "failed" | "skipped",
  sentId: string | null,
  error: string | null,
): Promise<boolean> {
  const row = await client.get<{ rule_id: string }>(
    `UPDATE forwarding_delivery_jobs SET status=$5,sent_email_id=$6,error=$7,updated_at=now()
     WHERE tenant_id=$1 AND rule_id=$2 AND message_id=$3 AND lease=$4::uuid AND status='processing' RETURNING rule_id`,
    [
      tenantId,
      claim.rule_id,
      claim.message_id,
      claim.lease,
      status,
      sentId,
      error,
    ],
  );
  return row !== null;
}
