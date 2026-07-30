export type EvidenceSanitizerStatus = "safe" | "unsafe";
export type EvidenceSanitizerInputFormat = "auto" | "json" | "text";

export interface EvidenceSanitizerFinding {
  path: string;
  kind: string;
  message: string;
  replacement: string;
}

export interface EvidenceSanitizerReport {
  kind: "open-uptime.evidence-sanitizer";
  status: EvidenceSanitizerStatus;
  unsafe: boolean;
  redacted: true;
  redactionStatus: "redacted";
  checkedAt: string;
  input: {
    format: "json" | "text";
    source: string | null;
  };
  summary: {
    findings: number;
  };
  findings: EvidenceSanitizerFinding[];
  sanitized: unknown;
  nextActions: string[];
}

export interface EvidenceSanitizerOptions {
  inputFormat?: EvidenceSanitizerInputFormat;
  source?: string | null;
  now?: () => Date;
}

interface EvidenceRule {
  kind: string;
  message: string;
  replacement: string;
  pattern: RegExp;
  replace?: (...args: unknown[]) => string;
}

const EVIDENCE_RULES: EvidenceRule[] = [
  {
    kind: "aws-arn",
    message: "AWS ARNs must not appear in shared evidence",
    replacement: "[redacted-aws-arn]",
    pattern: /\barn:aws[a-z-]*:[A-Za-z0-9-]+:[A-Za-z0-9-]*:\d{12}:[^\s"'<>),}]+/g,
  },
  {
    kind: "aws-account-id",
    message: "AWS account ids must not appear in shared evidence",
    replacement: "[redacted-aws-account-id]",
    pattern: /\b\d{12}\b/g,
  },
  {
    kind: "cloudfront-host",
    message: "Raw CloudFront hosts must be redacted before shared evidence",
    replacement: "[redacted-edge-host]",
    pattern: /\b(?:[A-Za-z0-9-]+\.)?d[A-Za-z0-9]{8,}\.cloudfront\.net\b/gi,
  },
  {
    kind: "alb-elb-host",
    message: "Raw ALB/ELB origin hosts must be redacted before shared evidence",
    replacement: "[redacted-direct-origin-host]",
    pattern: /\b[A-Za-z0-9.-]*\.(?:[A-Za-z0-9-]+\.)?elb\.amazonaws\.com\b/gi,
  },
  {
    kind: "credentialed-url",
    message: "URLs with embedded credentials must not appear in shared evidence",
    replacement: "[redacted-credentialed-url]",
    pattern: /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>/@:]+:[^\s"'<>/@]+@[^\s"'<>]+/gi,
  },
  {
    kind: "database-url",
    message: "Database URLs must not appear in shared evidence",
    replacement: "[redacted-database-url]",
    pattern: /\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi,
  },
  {
    kind: "private-url",
    message: "Local, metadata, private, or internal URLs must not appear in shared evidence",
    replacement: "[redacted-private-url]",
    pattern: /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|[^\/\s"'<>),]+\.internal|[^\/\s"'<>),]+\.local)(?::\d+)?[^\s"'<>),]*/gi,
  },
  {
    kind: "private-ip",
    message: "Private, loopback, and metadata IP addresses must not appear in shared evidence",
    replacement: "[redacted-private-ip]",
    pattern: /\b(?:127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2})\b/g,
  },
  {
    kind: "aws-resource-id",
    message: "Concrete AWS resource ids must not appear in shared evidence",
    replacement: "[redacted-aws-resource-id]",
    pattern: /\b(?:vpc|subnet|sg|rtb|igw|nat|eipalloc|eni|fs|fsap|vol|snap|ami|i)-[0-9a-f]{8,}\b/gi,
  },
  {
    kind: "cloudfront-distribution-id",
    message: "CloudFront distribution ids must not appear in shared evidence",
    replacement: "[redacted-cloudfront-distribution-id]",
    pattern: /\bE[A-Z0-9]{12,}\b/g,
  },
  {
    kind: "s3-arn",
    message: "S3 bucket and object ARNs must not appear in shared evidence",
    replacement: "[redacted-s3-arn]",
    pattern: /\barn:aws[a-z-]*:s3:::[^\s"'<>),}]+/g,
  },
  {
    kind: "s3-uri",
    message: "S3 bucket and object URIs must not appear in shared evidence",
    replacement: "[redacted-s3-uri]",
    pattern: /\bs3:\/\/[^\s"'<>),}]+/gi,
  },
  {
    kind: "workspace-id",
    message: "Private workspace ids must be redacted before shared evidence",
    replacement: "[redacted-workspace-id]",
    pattern: /\bwks_[a-z0-9]{8,}\b/gi,
  },
  {
    kind: "terraform-artifact",
    message: "Terraform plan/state/tfvars paths must not appear in shared evidence",
    replacement: "[redacted-terraform-artifact]",
    pattern: /\S+\.(?:tfplan|tfstate|tfvars)(?!\.example)\b/gi,
  },
  {
    kind: "local-path",
    message: "Local filesystem paths must not appear in shared evidence",
    replacement: "[redacted-local-path]",
    pattern: /(?:~\/|\/home\/[A-Za-z0-9._-]+\/|\/Users\/[A-Za-z0-9._-]+\/|\/tmp\/|[A-Za-z]:\\)[^\s"'<>]*/g,
  },
  {
    kind: "container-image-digest",
    message: "Container image digests are private deployment evidence and must be redacted",
    replacement: "[redacted-image-digest]",
    pattern: /\bsha256:[0-9a-f]{64}\b/gi,
  },
  {
    kind: "access-key",
    message: "Access-key-shaped values must not appear in shared evidence",
    replacement: "[redacted-access-key]",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: "bearer-token",
    message: "Bearer tokens must not appear in shared evidence",
    replacement: "Bearer [redacted]",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  },
  {
    kind: "provider-token",
    message: "Provider token-shaped values must not appear in shared evidence",
    replacement: "[redacted-provider-token]",
    pattern: /\b(?:ghp|github_pat|sk|rk|esk|xox[baprs])[-_][A-Za-z0-9_=-]{12,}\b/g,
  },
  {
    kind: "pem-private-key",
    message: "PEM private keys must not appear in shared evidence",
    replacement: "[redacted-private-key]",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    kind: "email-address",
    message: "Raw email addresses must not appear in shared evidence",
    replacement: "[redacted-email]",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    kind: "phone-number",
    message: "Raw phone numbers must not appear in shared evidence",
    replacement: "[redacted-phone]",
    pattern: /(?<![A-Za-z0-9.-])(?:\+\d{8,15}|\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?![A-Za-z0-9.-])/g,
  },
  {
    kind: "secret-assignment",
    message: "Secret-like assignments must be redacted before shared evidence",
    replacement: "secret=redacted",
    pattern: /\b(password|passwd|pwd|token|secret|secret[_-]?access[_-]?key|api[_-]?key|access[_-]?token|signature|jwt)(\s*[:=]\s*)([^\s"'&<>),]+)/gi,
    replace: (_match, key, separator) => `${String(key)}${String(separator)}redacted`,
  },
];

export function sanitizeEvidenceInput(input: string | unknown, options: EvidenceSanitizerOptions = {}): EvidenceSanitizerReport {
  const findings: EvidenceSanitizerFinding[] = [];
  const parsed = typeof input === "string"
    ? parseEvidenceInput(input, options.inputFormat ?? "auto")
    : { value: input, format: "json" as const };
  const source = sanitizeSource(options.source ?? null, findings);
  const sanitized = sanitizeValue(parsed.value, "$", findings);
  const unsafe = findings.length > 0;
  return {
    kind: "open-uptime.evidence-sanitizer",
    status: unsafe ? "unsafe" : "safe",
    unsafe,
    redacted: true,
    redactionStatus: "redacted",
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    input: {
      format: parsed.format,
      source,
    },
    summary: {
      findings: findings.length,
    },
    findings,
    sanitized,
    nextActions: unsafe
      ? [
        "Use the sanitized field from this report for shared evidence.",
        "Keep raw Terraform plans, state, tfvars, URLs, ARNs, account ids, image digests, local paths, recipients, and secret values in private operator storage only.",
        "Re-run uptimemon evidence sanitize --fail-on-unsafe on the final evidence artifact before posting it to docs, todos, project metadata, or release notes.",
      ]
      : ["Shared evidence passed the Open Uptime sanitizer; still keep raw private terminal output out of public docs."],
  };
}

export function parseEvidenceInput(raw: string, format: EvidenceSanitizerInputFormat = "auto"): { value: unknown; format: "json" | "text" } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("evidence input is empty");
  if (format === "text") return { value: raw, format: "text" };
  if (format === "json") {
    try {
      return { value: JSON.parse(trimmed) as unknown, format: "json" };
    } catch {
      throw new Error("evidence input is not valid JSON");
    }
  }
  try {
    return { value: JSON.parse(trimmed) as unknown, format: "json" };
  } catch {
    return { value: raw, format: "text" };
  }
}

export function renderEvidenceSanitizerReport(report: EvidenceSanitizerReport): string {
  const lines = [
    `evidence sanitizer: ${report.status}`,
    `findings: ${report.summary.findings}`,
  ];
  if (report.findings.length) {
    lines.push("blocked shared-evidence values:");
    for (const finding of report.findings) {
      lines.push(`- ${finding.path} ${finding.kind}: ${finding.message}`);
    }
    lines.push("next actions:");
  }
  lines.push(...report.nextActions.map((action) => `- ${action}`));
  return lines.join("\n");
}

function sanitizeValue(value: unknown, path: string, findings: EvidenceSanitizerFinding[]): unknown {
  if (typeof value === "string") return sanitizeString(value, path, findings);
  if (Array.isArray(value)) return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`, findings));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    let index = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const keyResult = sanitizeObjectKey(key, path, index, findings);
      output[keyResult.key] = sanitizeValue(item, keyResult.path, findings);
      index += 1;
    }
    return output;
  }
  return value;
}

function sanitizeObjectKey(key: string, parentPath: string, index: number, findings: EvidenceSanitizerFinding[]): { key: string; path: string } {
  const localFindings: EvidenceSanitizerFinding[] = [];
  const sanitized = sanitizeString(key, `${parentPath}.[key]`, localFindings);
  if (localFindings.length === 0 && key.length <= 96 && !/[\x00-\x1f\x7f-\x9f]/.test(key)) {
    return { key, path: `${parentPath}.${key}` };
  }
  findings.push({
    path: `${parentPath}.[redacted-key-${index}]`,
    kind: "object-key",
    message: "Unsafe object keys must not appear in shared evidence or finding paths",
    replacement: `[redacted-key-${index}]`,
  });
  return {
    key: `[redacted-key-${index}]`,
    path: `${parentPath}.[redacted-key-${index}]`,
  };
}

function sanitizeString(value: string, path: string, findings: EvidenceSanitizerFinding[]): string {
  if (isFullyRedactedPlaceholder(value)) return value;
  let sanitized = value;
  if (isSensitivePath(path) && !isAllowedSensitiveValue(value)) {
    findings.push({
      path,
      kind: "sensitive-field-value",
      message: "Sensitive field values must be redacted or represented by an environment variable name",
      replacement: "[redacted-sensitive-field]",
    });
    sanitized = "[redacted-sensitive-field]";
  }
  for (const rule of EVIDENCE_RULES) {
    let found = false;
    sanitized = sanitized.replace(rule.pattern, (...args: unknown[]) => {
      const match = String(args[0]);
      if (rule.kind === "terraform-artifact" && match.endsWith(".tfvars.example")) return match;
      found = true;
      return rule.replace ? rule.replace(...args) : rule.replacement;
    });
    if (found) {
      findings.push({
        path,
        kind: rule.kind,
        message: rule.message,
        replacement: rule.replacement,
      });
    }
  }
  return sanitized;
}

function sanitizeSource(source: string | null, findings: EvidenceSanitizerFinding[]): string | null {
  if (!source) return null;
  if (source === "stdin" || source === "text" || source === "file") return source;
  const sanitized = sanitizeString(source, "$.input.source", findings);
  return sanitized === source ? source : "[redacted-source]";
}

function isSensitivePath(path: string): boolean {
  const leaf = (path.split(".").pop() ?? path).replace(/\[\d+\]$/g, "");
  return (
    /(secret|token|password|passwd|pwd|credential|private[_-]?key|bearer|jwt|signature|cloudfront.*header.*value)/i.test(leaf)
    || isAwsOriginHeaderValuePath(path, leaf)
  )
    && !/(public[_-]?key|keyCount|idempotencyKey|integrity|shasum|fingerprint|envName)/i.test(leaf);
}

function isAwsOriginHeaderValuePath(path: string, leaf: string): boolean {
  const normalized = path.toLowerCase();
  const normalizedLeaf = leaf.toLowerCase();
  const isValueLeaf = normalizedLeaf === "value" || normalizedLeaf === "values" || normalizedLeaf === "headervalue";
  if (!isValueLeaf) return false;
  return /customheaders|custom_header/.test(normalized)
    || /httpheaderconfig|http_header/.test(normalized)
    || /origin.*header/.test(normalized);
}

function isAllowedSensitiveValue(value: string): boolean {
  const trimmed = value.trim();
  return isFullyRedactedPlaceholder(trimmed)
    || /^<[^>]*(?:secret-ref|redacted|unset|missing|none)[^>]*>$/i.test(trimmed);
}

function isFullyRedactedPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:\[redacted[^\]]*\]|\[REDACTED[^\]]*\]|redacted|REDACTED)$/i.test(trimmed);
}

export type EvidenceSanitizeStatus = EvidenceSanitizerStatus;
export type EvidenceSanitizeFinding = EvidenceSanitizerFinding;
export type EvidenceSanitizeReport = EvidenceSanitizerReport;
export type EvidenceSanitizeOptions = EvidenceSanitizerOptions;

export const sanitizeEvidenceForSharing = sanitizeEvidenceInput;
export const renderEvidenceSanitizeReport = renderEvidenceSanitizerReport;
