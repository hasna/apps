/** Monetary SDK inputs are integer cents. Keep this internal so every public
 * service/store boundary refuses invalid values before reads or mutations. */
export function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(field + " must be a nonnegative safe integer number of cents");
  }
}
