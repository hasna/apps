import { isStaleStatus, type GeneratedArtifactProvenance, type KnowledgeProvenance } from './provenance';

export const KNOWLEDGE_ANSWER_PURPOSE = 'knowledge_answer';
export const KNOWLEDGE_INDEX_PURPOSE = 'knowledge_index';

export type AccessProvenance = KnowledgeProvenance | GeneratedArtifactProvenance | null;

export interface SourceAccessDecision {
  allowed: boolean;
  code: string;
  message: string;
}

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function sourceAccessDecision(permissions: Record<string, unknown>, purpose: string): SourceAccessDecision {
  const mode = permissions.mode;
  if (typeof mode === 'string' && mode !== 'read_only') {
    return {
      allowed: false,
      code: 'permission_mode_denied',
      message: `Permission mode is ${mode}, expected read_only.`,
    };
  }

  const denied = permissions.denied_purposes;
  if (Array.isArray(denied) && denied.includes(purpose)) {
    return {
      allowed: false,
      code: 'purpose_explicitly_denied',
      message: `Purpose ${purpose} is explicitly denied.`,
    };
  }

  const allowed = permissions.allowed_purposes;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(purpose)) {
    return {
      allowed: false,
      code: 'purpose_not_allowed',
      message: `Purpose ${purpose} is not in allowed purposes: ${allowed.join(', ')}.`,
    };
  }

  return {
    allowed: true,
    code: 'allow',
    message: 'Source purpose allowed.',
  };
}

export function metadataIsStale(metadata: Record<string, unknown>): boolean {
  if (metadata.reindex_required === true) return true;
  const status = metadata.status;
  return typeof status === 'string' && isStaleStatus(status);
}

export function provenanceIsStale(provenance: AccessProvenance): boolean {
  if (!provenance) return false;
  if ('stale' in provenance && provenance.stale) return true;
  if ('status' in provenance) return isStaleStatus(provenance.status);
  return false;
}

export function provenanceSourceRefs(provenance: AccessProvenance): string[] {
  if (!provenance) return [];
  if ('source_refs' in provenance) return provenance.source_refs.filter((ref) => typeof ref === 'string' && ref.length > 0);
  return [provenance.source_ref, provenance.source_uri].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
}

export function sourceUriCandidates(ref: string): string[] {
  const candidates = new Set<string>([ref]);
  const revisionIndex = ref.indexOf('/revision/');
  if (revisionIndex > 0) candidates.add(ref.slice(0, revisionIndex));
  return Array.from(candidates);
}
