/** Password hashing via Bun's built-in argon2id (no external dependency). */

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== "string") return "password must be a string";
  if (password.length < MIN_PASSWORD_LENGTH) return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}
