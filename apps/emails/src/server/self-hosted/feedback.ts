/** Feedback is saved tenant content; this resource does not send email or notifications. */
export function normalizeFeedback(body: Record<string, unknown>, create: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (create || "message" in body) {
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 10000) {
      throw new Error("Feedback message must contain 1 to 10000 characters.");
    }
    result.message = body.message.trim();
  }
  if ("email" in body) {
    if (body.email === null) result.email = null;
    else if (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      throw new Error("Feedback email must be a valid email address or null.");
    } else result.email = body.email.trim();
  }
  if ("category" in body) {
    if (!["bug", "feature", "general"].includes(String(body.category)) || typeof body.category !== "string") {
      throw new Error("Feedback category must be bug, feature, or general.");
    }
    result.category = body.category;
  }
  return result;
}
