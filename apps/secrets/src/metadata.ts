import { scanInputExposures } from "./scanner.js";
import { MetadataValidationError } from "./store/types.js";

/** Upper bound on a free-text metadata field (reason/label), spec §2.7.6. */
export const MAX_METADATA_LENGTH = 1000;

/**
 * Metadata write policy (spec §2.7.6): `reason` and `label` are untrusted free
 * text — an operator note, never a transport for value material. Before either
 * is persisted it is length-bounded and scanned with the package's own input
 * scanner (`scanInputExposures`), the same detector set used to gate staged
 * commits. Credential-shaped content is REFUSED with a typed error: it is
 * never stored and never echoed. The error message names the field only, so a
 * rejected payload cannot round-trip out of the vault as an error string.
 *
 * Rows written before this guard landed are not retroactively rescanned; the
 * guard binds new writes.
 */
export function assertMetadataSafe(field: string, value: string | undefined): void {
  if (value === undefined || value === "") return;
  if (value.length > MAX_METADATA_LENGTH) {
    throw new MetadataValidationError(`${field} exceeds the ${MAX_METADATA_LENGTH}-character metadata bound.`);
  }
  const result = scanInputExposures({ text: value });
  if (result.findingCount > 0) {
    throw new MetadataValidationError(
      `${field} contains credential-shaped content and was refused. Use a plain description without values.`,
    );
  }
}
