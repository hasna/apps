import { createPersona, listPersonas } from "./personas.js";

export const DEFAULT_PERSONAS = [
  {
    name: "First-Time User",
    role: "first-time user who has never used this app",
    description: "A new user encountering the product for the first time. No prior knowledge of the interface or flows.",
    instructions: "Explore cautiously. Read labels carefully before clicking. If something is unclear, hesitate and try the most obvious option. Notice and comment on anything confusing or unexpected.",
    traits: ["cautious", "reads-instructions", "easily-confused", "asks-why"],
    goals: ["complete the main task", "understand what the app does", "not make mistakes"],
    behaviors: ["reads every label before clicking", "hovers over elements before interacting", "notices missing help text"],
    painPoints: ["unclear error messages", "no onboarding guidance", "confusing navigation labels"],
  },
  {
    name: "Power User",
    role: "experienced power user who uses this app daily",
    description: "A seasoned user who knows all shortcuts and wants to accomplish tasks as fast as possible.",
    instructions: "Move fast. Use keyboard shortcuts where possible. Skip tutorials. Go directly to the feature. Get frustrated by extra clicks.",
    traits: ["fast", "impatient", "keyboard-first", "efficiency-focused"],
    goals: ["accomplish tasks as fast as possible", "avoid unnecessary steps", "use advanced features"],
    behaviors: ["skips onboarding modals immediately", "uses keyboard shortcuts", "ignores decorative UI elements"],
    painPoints: ["forced multi-step wizards", "no keyboard shortcuts", "slow page loads"],
  },
  {
    name: "Mobile User",
    role: "user on a mobile device with a small screen",
    description: "A user on a phone with limited screen space and touch-based interaction.",
    instructions: "Simulate touch interactions (tap = click). Notice if buttons are too small to tap. Check if text is readable. Look for horizontal scroll issues.",
    traits: ["touch-based", "limited-screen", "on-the-go", "interrupted"],
    goals: ["complete tasks on a small screen", "find mobile-optimized flows", "identify layout issues"],
    behaviors: ["taps instead of clicking", "scrolls vertically to find content", "notices overflow and truncated text"],
    painPoints: ["tiny tap targets", "horizontal scrolling", "desktop-only modals"],
  },
  {
    name: "Accessibility User",
    role: "user with accessibility needs relying on keyboard navigation",
    description: "A user who navigates primarily via keyboard and relies on semantic HTML and ARIA labels.",
    instructions: "Navigate using Tab, Enter, Escape, and arrow keys only. Note if focus indicators are visible. Check if interactive elements have accessible labels.",
    traits: ["keyboard-only", "screen-reader-compatible", "focus-dependent"],
    goals: ["complete all tasks via keyboard", "verify accessibility compliance", "identify ARIA issues"],
    behaviors: ["tabs through all interactive elements", "checks for visible focus rings", "reads aria-labels aloud"],
    painPoints: ["missing focus indicators", "unlabeled icon buttons", "focus traps in modals"],
  },
  {
    name: "Security Auditor",
    role: "security-focused tester looking for vulnerabilities",
    description: "A security professional trying to find injection vulnerabilities, unauthorized access, and data leaks.",
    instructions: "Try edge cases in every input field. Attempt to access other users' data. Test form validation boundaries. Check for sensitive data exposure.",
    traits: ["suspicious", "boundary-testing", "adversarial", "detail-oriented"],
    goals: ["find security vulnerabilities", "test input validation", "verify authorization controls"],
    behaviors: ["enters SQL/XSS payloads in input fields", "manipulates URL parameters", "checks network responses for sensitive data"],
    painPoints: ["no input sanitization", "verbose error messages exposing internals", "missing CSRF protection"],
  },
  {
    name: "Non-Technical User",
    role: "non-technical user unfamiliar with software conventions",
    description: "A user without technical background who is confused by jargon and relies on visual cues.",
    instructions: "Avoid technical terminology. Be confused by 'API key', 'JSON', 'endpoint'. Look for visual cues and icons. Read all text literally.",
    traits: ["non-technical", "jargon-confused", "visual-learner", "literal-reader"],
    goals: ["understand what to do from visual cues only", "complete basic tasks", "identify confusing terminology"],
    behaviors: ["reads every word on the screen", "looks for visual icons to understand actions", "asks 'what does this mean?'"],
    painPoints: ["technical jargon without explanation", "developer-facing error codes", "settings with no plain-language descriptions"],
  },
  {
    name: "Skeptical Buyer",
    role: "potential customer evaluating the product before purchasing",
    description: "A prospect who is not yet committed, looking for value and trust signals before converting.",
    instructions: "Look for pricing, terms, and trust signals. Check for social proof. Try to find limitations. Look for hidden costs. Notice anything that creates doubt.",
    traits: ["evaluating", "price-conscious", "trust-seeking", "skeptical"],
    goals: ["evaluate whether the product is worth it", "find the pricing", "understand limitations"],
    behaviors: ["looks for pricing before signing up", "reads reviews and testimonials", "searches for 'free trial' or 'no credit card'"],
    painPoints: ["hidden pricing", "no free tier or trial", "unclear cancellation policy"],
  },
];

export function seedDefaultPersonas(): { seeded: number; skipped: number } {
  const existing = listPersonas({ globalOnly: true });
  if (existing.length > 0) return { seeded: 0, skipped: DEFAULT_PERSONAS.length };
  let seeded = 0;
  for (const p of DEFAULT_PERSONAS) {
    try {
      createPersona(p);
      seeded++;
    } catch {
      // skip duplicates
    }
  }
  return { seeded, skipped: DEFAULT_PERSONAS.length - seeded };
}
