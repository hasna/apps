const TRANSIENT_AUDIT_STATUS = /^error: audit request failed \(status (429|502|503|504)\)$/;
const BUN_AUDIT_HEADER = /^bun audit v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? \([0-9a-f]{8,}\)$/i;

/** Return the registry HTTP status only for Bun's explicit transient audit error. */
export function transientAuditStatus(result) {
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const transientLines = output.filter((line) => TRANSIENT_AUDIT_STATUS.test(line));
  if (transientLines.length !== 1 || output.some((line) => !BUN_AUDIT_HEADER.test(line) && !TRANSIENT_AUDIT_STATUS.test(line))) return null;
  const match = TRANSIENT_AUDIT_STATUS.exec(transientLines[0]);
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
