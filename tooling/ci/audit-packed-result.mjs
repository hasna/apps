const TRANSIENT_AUDIT_STATUS = /audit request failed \(status (429|502|503|504)\)/;

/** Return the registry HTTP status only for Bun's explicit transient audit error. */
export function transientAuditStatus(result) {
  const match = TRANSIENT_AUDIT_STATUS.exec(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  return match ? Number(match[1]) : null;
}

/**
 * Retry only an audit request refused by a transient registry/gateway response.
 * Vulnerability findings and all other failures remain terminal.
 */
export function runAuditWithRetry(runAudit, wait, maxAttempts = 3) {
  let result = runAudit();
  for (let attempt = 1; attempt < maxAttempts && transientAuditStatus(result) !== null; attempt += 1) {
    wait(2 ** attempt);
    result = runAudit();
  }
  return result;
}
