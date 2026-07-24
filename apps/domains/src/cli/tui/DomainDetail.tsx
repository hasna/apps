import React from "react";
import { Box, Text } from "ink";
import type { DomainDetails } from "../../db/domains.js";
import type { DnsRecord } from "../../db/domains.js";
import { STATUS_COLORS, formatDate } from "./format.js";

interface DomainDetailProps {
  details: DomainDetails;
  dnsRecords?: DnsRecord[];
  compact?: boolean;
}

export function DomainDetail({ details, dnsRecords = [], compact = false }: DomainDetailProps) {
  const { domain, offers, emails } = details;
  const statusColor = STATUS_COLORS[domain.status] ?? "white";

  return (
    <Box flexDirection="column" width={compact ? "45%" : "100%"} paddingLeft={compact ? 1 : 0}>
      {!compact && (
        <Box marginBottom={1}>
          <Text dimColor>[esc] back · [r] refresh · q quit</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          {domain.name}
        </Text>
        <Text color={statusColor}>[{domain.status}]</Text>
      </Box>

      <Field label="Registrar" value={domain.registrar} />
      <Field label="Registered" value={formatDate(domain.registered_at)} />
      <Field label="Expires" value={formatDate(domain.expires_at)} />
      <Field label="Auto-renew" value={domain.auto_renew ? "yes" : "no"} />
      {domain.is_premium && (
        <>
          <Field label="Premium" value="yes" />
          <Field label="Premium ask" value={domain.premium_price?.toString() ?? "—"} />
        </>
      )}
      {domain.purchase_price !== null && (
        <Field label="Purchase price" value={String(domain.purchase_price)} />
      )}
      <Field label="SSL issuer" value={domain.ssl_issuer} />
      <Field label="SSL expires" value={formatDate(domain.ssl_expires_at)} />

      {domain.nameservers.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>Nameservers</Text>
          {domain.nameservers.slice(0, compact ? 3 : 8).map((ns) => (
            <Text key={ns} dimColor>
              {"  "}
              {ns}
            </Text>
          ))}
        </Box>
      )}

      {!compact && dnsRecords.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>DNS records ({dnsRecords.length})</Text>
          {dnsRecords.slice(0, 8).map((record) => (
            <Text key={record.id} dimColor>
              {"  "}
              {record.type} {record.name} → {record.value}
            </Text>
          ))}
          {dnsRecords.length > 8 && (
            <Text dimColor>  … {dnsRecords.length - 8} more</Text>
          )}
        </Box>
      )}

      {(offers.length > 0 || emails.length > 0) && (
        <Box marginTop={1}>
          <Text dimColor>
            Offers: {offers.length} · Linked emails: {emails.length}
            {dnsRecords.length > 0 ? ` · DNS: ${dnsRecords.length}` : ""}
          </Text>
        </Box>
      )}

      {domain.notes && !compact && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>Notes</Text>
          <Text wrap="wrap">{domain.notes}</Text>
        </Box>
      )}

      {!compact && (
        <Box marginTop={1}>
          <Text dimColor>ID: {domain.id}</Text>
        </Box>
      )}
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === "—") {
    return (
      <Box>
        <Text dimColor>{label.padEnd(14)}</Text>
        <Text dimColor>—</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor>{label.padEnd(14)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
