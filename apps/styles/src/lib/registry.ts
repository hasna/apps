export interface StyleMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  principles: string[];
}

export const CATEGORIES = [
  "Minimalist",
  "Brutalist",
  "Corporate",
  "Startup",
  "Glassmorphism",
  "Editorial",
  "Retro",
  "Material",
  "Neubrutalism",
  "Neumorphic",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const ALL_STYLE_NAMES = [
  "minimalist",
  "brutalist",
  "corporate",
  "startup",
  "glassmorphism",
  "editorial",
  "retro",
  "material",
  "neubrutalism",
  "neumorphic",
] as const;

export type StyleName = (typeof ALL_STYLE_NAMES)[number];

export const STYLES: StyleMeta[] = [
  {
    name: "minimalist",
    displayName: "Minimalist",
    description:
      "Clean, white-space-heavy design focused on content clarity. Strips away decoration to let the work speak for itself. Influenced by Dieter Rams and Swiss design principles.",
    category: "Minimalist",
    tags: ["clean", "white-space", "typography", "simple", "content-first"],
    principles: [
      "Every element must earn its place",
      "White space is not empty space — it is visual breathing room",
      "Typography carries the weight of the design",
    ],
  },
  {
    name: "brutalist",
    displayName: "Brutalist",
    description:
      "Raw, confrontational web design that rejects conventional aesthetics. Uses stark contrasts, monospaced fonts, and exposes the structural skeleton of the page. Inspired by architectural brutalism.",
    category: "Brutalist",
    tags: ["raw", "bold", "monospace", "high-contrast", "unconventional"],
    principles: [
      "Expose structure rather than hide it",
      "Form is function — decoration is dishonesty",
      "Contrast is communication",
    ],
  },
  {
    name: "corporate",
    displayName: "Corporate",
    description:
      "Professional, trustworthy design language used by enterprise software and financial services. Conservative color palettes, structured layouts, and conventional UI patterns to maximize accessibility and familiarity.",
    category: "Corporate",
    tags: ["professional", "trustworthy", "structured", "enterprise", "accessible"],
    principles: [
      "Consistency builds confidence",
      "Familiarity reduces cognitive load for task-oriented users",
      "Hierarchy and clarity over novelty",
    ],
  },
  {
    name: "startup",
    displayName: "Startup",
    description:
      "Modern, product-led design language popular with SaaS and tech companies. Combines gradients, rounded components, and bold typography to convey energy and momentum.",
    category: "Startup",
    tags: ["modern", "gradient", "saas", "product", "rounded"],
    principles: [
      "Delight through motion and micro-interactions",
      "Bold visual hierarchy to guide conversion",
      "Product-forward: UI serves the feature",
    ],
  },
  {
    name: "glassmorphism",
    displayName: "Glassmorphism",
    description:
      "Frosted-glass aesthetic with translucent surfaces, subtle borders, and layered depth. Creates a sense of depth and lightness. Works best on gradient or photography backgrounds.",
    category: "Glassmorphism",
    tags: ["glass", "blur", "translucent", "depth", "layered"],
    principles: [
      "Layers create depth without shadows",
      "Blur connects foreground to background",
      "Transparency implies lightness and modernity",
    ],
  },
  {
    name: "editorial",
    displayName: "Editorial",
    description:
      "Print-influenced design with expressive typography, asymmetric layouts, and strong visual rhythm. Draws from magazine and newspaper layout traditions for rich content experiences.",
    category: "Editorial",
    tags: ["typography", "print", "magazine", "rhythm", "expressive"],
    principles: [
      "Typography is the primary design element",
      "Grid exists to be broken deliberately",
      "Visual rhythm guides the reader through content",
    ],
  },
  {
    name: "retro",
    displayName: "Retro / Vintage",
    description:
      "Nostalgic design evoking the aesthetics of the 70s, 80s, or 90s. Uses muted warm color palettes, vintage typefaces, grain textures, and halftone patterns.",
    category: "Retro",
    tags: ["vintage", "nostalgic", "warm", "texture", "halftone"],
    principles: [
      "Imperfection is character",
      "Warm palettes evoke memory and emotion",
      "Texture and grain add analog depth to digital surfaces",
    ],
  },
  {
    name: "material",
    displayName: "Material Design",
    description:
      "Google's Material Design system: elevation-based UI, responsive animations, and a cohesive component library. Clear visual hierarchy through shadows, color, and motion.",
    category: "Material",
    tags: ["google", "elevation", "shadows", "motion", "components"],
    principles: [
      "Elevation communicates importance and interactivity",
      "Motion provides meaning, not just decoration",
      "Color expresses brand hierarchy and state",
    ],
  },
  {
    name: "neubrutalism",
    displayName: "Neubrutalism",
    description:
      "The playful evolution of brutalism. Hard drop shadows, bold borders, vivid flat colors, and chunky UI elements. Combines rawness with color and personality.",
    category: "Neubrutalism",
    tags: ["bold", "drop-shadow", "colorful", "playful", "chunky"],
    principles: [
      "Hard borders and shadows make elements tactile and real",
      "Flat colors at maximum saturation signal confidence",
      "Chunky components invite interaction",
    ],
  },
  {
    name: "neumorphic",
    displayName: "Neumorphism",
    description:
      "Soft UI with extruded elements that appear to be carved from or pushed out of the background. Uses dual light/dark shadows against a neutral background. Creates a soft, tactile, almost physical feel.",
    category: "Neumorphic",
    tags: ["soft-ui", "extruded", "shadows", "neutral", "tactile"],
    principles: [
      "Elements exist on — not above — the surface",
      "Dual shadows simulate a single ambient light source",
      "Neutrality in color lets form carry all the expression",
    ],
  },
];

export function getStyle(name: string): StyleMeta | undefined {
  return STYLES.find((s) => s.name === name.toLowerCase());
}

export function searchStyles(query: string): StyleMeta[] {
  const q = query.toLowerCase().trim();
  if (!q) return STYLES;

  const scored = STYLES.map((style) => {
    let score = 0;
    const nameLower = style.name.toLowerCase();
    const displayLower = style.displayName.toLowerCase();
    const descLower = style.description.toLowerCase();

    if (nameLower === q) score += 100;
    else if (nameLower.startsWith(q)) score += 60;
    else if (nameLower.includes(q)) score += 40;

    if (displayLower === q) score += 80;
    else if (displayLower.startsWith(q)) score += 50;
    else if (displayLower.includes(q)) score += 30;

    if (descLower.includes(q)) score += 15;

    for (const tag of style.tags) {
      if (tag.toLowerCase() === q) score += 35;
      else if (tag.toLowerCase().includes(q)) score += 20;
    }

    return { style, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.style);
}

export function getStylesByCategory(cat: string): StyleMeta[] {
  const catLower = cat.toLowerCase();
  return STYLES.filter((s) => s.category.toLowerCase() === catLower);
}

/**
 * Levenshtein distance for typo suggestions
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function findSimilarStyles(name: string): string[] {
  const nameLower = name.toLowerCase();
  return STYLES.map((s) => ({
    name: s.name,
    dist: levenshtein(nameLower, s.name),
  }))
    .filter((s) => s.dist <= 3)
    .sort((a, b) => a.dist - b.dist)
    .map((s) => s.name)
    .slice(0, 3);
}
