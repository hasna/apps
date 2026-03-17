import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { createScenario } from "../db/scenarios.js";
import { ensureProject } from "../db/projects.js";
import type { CreateScenarioInput } from "../types/index.js";

// ─── Framework Detection ────────────────────────────────────────────────────

interface FrameworkInfo {
  name: string;
  defaultUrl: string;
  features: string[];
}

export function detectFramework(dir: string): FrameworkInfo | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depNames = Object.keys(allDeps);

  // Detect features
  const features: string[] = [];

  const hasAuth = depNames.some(
    (d) => d === "next-auth" || d.startsWith("@auth/") || d === "passport" || d === "lucia",
  );
  if (hasAuth) features.push("hasAuth");

  const hasForms = depNames.some(
    (d) => d === "react-hook-form" || d === "formik" || d === "zod",
  );
  if (hasForms) features.push("hasForms");

  // Detect framework
  if ("next" in allDeps) {
    return { name: "Next.js", defaultUrl: "http://localhost:3000", features };
  }
  if ("vite" in allDeps) {
    return { name: "Vite", defaultUrl: "http://localhost:5173", features };
  }
  if (depNames.some((d) => d.startsWith("@remix-run"))) {
    return { name: "Remix", defaultUrl: "http://localhost:3000", features };
  }
  if ("nuxt" in allDeps) {
    return { name: "Nuxt", defaultUrl: "http://localhost:3000", features };
  }
  if (depNames.some((d) => d.startsWith("svelte") || d === "@sveltejs/kit")) {
    return { name: "SvelteKit", defaultUrl: "http://localhost:5173", features };
  }
  if (depNames.some((d) => d.startsWith("@angular"))) {
    return { name: "Angular", defaultUrl: "http://localhost:4200", features };
  }
  if ("express" in allDeps) {
    return { name: "Express", defaultUrl: "http://localhost:3000", features };
  }

  return null;
}

// ─── Starter Scenarios ──────────────────────────────────────────────────────

export function getStarterScenarios(
  framework: { name: string; features: string[] },
  projectId: string,
): CreateScenarioInput[] {
  // Framework-specific starter scenarios
  if (framework.name === "Next.js") {
    const scenarios: CreateScenarioInput[] = [
      {
        name: "Homepage loads",
        description:
          "Navigate to the homepage and verify it loads correctly. Check that the main heading and content are visible, and there are no console errors.",
        tags: ["smoke"],
        priority: "high",
        projectId,
      },
      {
        name: "404 page works",
        description:
          "Navigate to a non-existent URL (e.g. /this-page-does-not-exist) and verify the Next.js 404 page renders correctly.",
        tags: ["smoke"],
        priority: "medium",
        projectId,
      },
      {
        name: "Navigation links work",
        description:
          "Click through the main navigation links and verify each page loads without errors. Check that client-side routing is working correctly.",
        tags: ["smoke"],
        priority: "medium",
        projectId,
      },
    ];

    if (framework.features.includes("hasAuth")) {
      scenarios.push(
        {
          name: "Login flow",
          description:
            "Navigate to the login page, enter valid credentials, and verify successful authentication and redirect.",
          tags: ["auth"],
          priority: "critical",
          projectId,
        },
        {
          name: "Protected route redirect",
          description:
            "Try to access a protected route without authentication and verify you are redirected to the login page.",
          tags: ["auth"],
          priority: "high",
          projectId,
        },
      );
    }

    if (framework.features.includes("hasForms")) {
      scenarios.push({
        name: "Form validation",
        description:
          "Submit forms with empty/invalid data and verify validation errors appear correctly.",
        tags: ["forms"],
        priority: "medium",
        projectId,
      });
    }

    return scenarios;
  }

  if (framework.name === "Vite" || framework.name === "SvelteKit") {
    const scenarios: CreateScenarioInput[] = [
      {
        name: "Homepage loads",
        description:
          "Navigate to the homepage and verify it loads correctly with no console errors.",
        tags: ["smoke"],
        priority: "high",
        projectId,
      },
      {
        name: "Mobile viewport check",
        description:
          "Set the viewport to 375x812 (iPhone) and verify the homepage renders correctly without horizontal scrolling or layout issues.",
        tags: ["responsive"],
        priority: "medium",
        projectId,
      },
      {
        name: "No console errors",
        description:
          "Navigate through the app and verify there are no JavaScript errors or warnings in the browser console.",
        tags: ["smoke"],
        priority: "high",
        projectId,
      },
    ];

    if (framework.features.includes("hasAuth")) {
      scenarios.push({
        name: "Login flow",
        description:
          "Navigate to the login page, enter valid credentials, and verify successful authentication.",
        tags: ["auth"],
        priority: "critical",
        projectId,
      });
    }

    return scenarios;
  }

  if (framework.name === "Nuxt") {
    const scenarios: CreateScenarioInput[] = [
      {
        name: "Homepage loads",
        description:
          "Navigate to the homepage and verify it loads correctly. Check that the main heading and content are visible.",
        tags: ["smoke"],
        priority: "high",
        projectId,
      },
      {
        name: "Navigation works",
        description:
          "Click through main navigation links and verify each page loads without errors.",
        tags: ["smoke"],
        priority: "medium",
        projectId,
      },
      {
        name: "Mobile viewport check",
        description:
          "Set the viewport to 375x812 and verify the homepage renders correctly on mobile.",
        tags: ["responsive"],
        priority: "medium",
        projectId,
      },
    ];

    if (framework.features.includes("hasAuth")) {
      scenarios.push({
        name: "Login flow",
        description:
          "Navigate to the login page, enter valid credentials, and verify successful authentication.",
        tags: ["auth"],
        priority: "critical",
        projectId,
      });
    }

    return scenarios;
  }

  // Generic / unknown framework
  const scenarios: CreateScenarioInput[] = [
    {
      name: "Homepage loads",
      description:
        "Navigate to the homepage and verify it loads correctly with no console errors. Check that the main heading, navigation, and primary CTA are visible.",
      tags: ["smoke"],
      priority: "high",
      projectId,
    },
    {
      name: "Form submit works",
      description:
        "Find the main form on the page, fill it in with valid test data, submit it, and verify the success state.",
      tags: ["smoke"],
      priority: "medium",
      projectId,
    },
    {
      name: "Mobile viewport check",
      description:
        "Set the viewport to 375x812 (iPhone) and verify the homepage renders correctly without horizontal scrolling or layout issues.",
      tags: ["responsive"],
      priority: "medium",
      projectId,
    },
  ];

  if (framework.features.includes("hasAuth")) {
    scenarios.push(
      {
        name: "Login flow",
        description:
          "Navigate to the login page, enter valid credentials, and verify successful authentication and redirect.",
        tags: ["auth"],
        priority: "critical",
        projectId,
      },
      {
        name: "Signup flow",
        description:
          "Navigate to the signup page, fill in registration details, and verify account creation succeeds.",
        tags: ["auth"],
        priority: "medium",
        projectId,
      },
    );
  }

  if (framework.features.includes("hasForms")) {
    scenarios.push({
      name: "Form validation",
      description:
        "Submit forms with empty/invalid data and verify validation errors appear correctly.",
      tags: ["forms"],
      priority: "medium",
      projectId,
    });
  }

  return scenarios;
}

// ─── Init Project ───────────────────────────────────────────────────────────

export interface InitOptions {
  name?: string;
  url?: string;
  path?: string;
  dir?: string;
}

export interface InitResult {
  project: ReturnType<typeof ensureProject>;
  scenarios: ReturnType<typeof createScenario>[];
  framework: FrameworkInfo | null;
  url: string;
}

export function initProject(options: InitOptions): InitResult {
  const dir = options.dir ?? process.cwd();
  const name = options.name ?? basename(dir);
  const framework = detectFramework(dir);
  const url = options.url ?? framework?.defaultUrl ?? "http://localhost:3000";
  const projectPath = options.path ?? dir;

  // Create or find the project
  const project = ensureProject(name, projectPath);

  // Create starter scenarios
  const starterInputs = getStarterScenarios(
    framework ?? { name: "Unknown", features: [] },
    project.id,
  );

  const scenarios = starterInputs.map((input) => createScenario(input));

  // Write activeProject to config
  const configDir = join(homedir(), ".testers");
  const configPath = join(configDir, "config.json");

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // ignore parse errors, overwrite
    }
  }

  config.activeProject = project.id;
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  return { project, scenarios, framework, url };
}
