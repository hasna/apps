import React from "react";
import { describe, test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Header } from "./Header.js";
import { CategorySelect } from "./CategorySelect.js";
import { ConnectorSelect } from "./ConnectorSelect.js";
import { ConnectorMeta } from "../../lib/registry.js";

const mockConnectors: ConnectorMeta[] = [
  {
    name: "stripe",
    displayName: "Stripe",
    description: "Payments, subscriptions, and billing",
    category: "Commerce & Finance",
    tags: ["payments"],
    version: "0.0.1",
  },
  {
    name: "figma",
    displayName: "Figma",
    description: "Design files and components",
    category: "Design & Content",
    tags: ["design"],
    version: "0.0.2",
  },
  {
    name: "anthropic",
    displayName: "Anthropic",
    description: "Claude AI models",
    category: "AI & ML",
    tags: ["ai", "llm"],
    version: "0.0.3",
  },
];

describe("Header", () => {
  test("renders title", () => {
    const { lastFrame } = render(<Header title="Test Title" />);
    expect(lastFrame()).toContain("Test Title");
  });

  test("renders title and subtitle", () => {
    const { lastFrame } = render(
      <Header title="My App" subtitle="A description" />
    );
    expect(lastFrame()).toContain("My App");
    expect(lastFrame()).toContain("A description");
  });

  test("renders default title when none provided", () => {
    const { lastFrame } = render(<Header />);
    expect(lastFrame()).toContain("Connectors");
  });

  test("renders without subtitle", () => {
    const { lastFrame } = render(<Header title="Only Title" />);
    expect(lastFrame()).toContain("Only Title");
  });
});

describe("CategorySelect", () => {
  test("renders all categories", () => {
    const { lastFrame } = render(
      <CategorySelect onSelect={() => {}} />
    );
    const frame = lastFrame();
    expect(frame).toContain("AI & ML");
    expect(frame).toContain("Developer Tools");
    expect(frame).toContain("Commerce & Finance");
    expect(frame).toContain("Select a category");
  });

  test("renders back button when onBack provided", () => {
    const { lastFrame } = render(
      <CategorySelect onSelect={() => {}} onBack={() => {}} />
    );
    expect(lastFrame()).toContain("Back");
  });

  test("renders without back button when onBack not provided", () => {
    const { lastFrame } = render(
      <CategorySelect onSelect={() => {}} />
    );
    // No back button, just categories
    const frame = lastFrame();
    expect(frame).toContain("AI & ML");
  });

  test("shows connector counts per category", () => {
    const { lastFrame } = render(
      <CategorySelect onSelect={() => {}} />
    );
    const frame = lastFrame();
    // Should have counts in parentheses
    expect(frame).toMatch(/\(\d+\)/);
  });
});

describe("ConnectorSelect", () => {
  test("renders table header", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Connector");
    expect(frame).toContain("Version");
    expect(frame).toContain("Description");
  });

  test("renders connector names", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("stripe");
    expect(frame).toContain("figma");
    expect(frame).toContain("anthropic");
  });

  test("renders versions", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("0.0.1");
    expect(frame).toContain("0.0.2");
    expect(frame).toContain("0.0.3");
  });

  test("renders descriptions", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Payments");
    expect(frame).toContain("Design files");
    expect(frame).toContain("Claude AI");
  });

  test("shows checked state for selected connectors", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set(["stripe"])}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    // Should have a checkmark for stripe
    expect(frame).toContain("[✓]");
    // Should have empty for others
    expect(frame).toContain("[ ]");
  });

  test("shows install button with selection count", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set(["stripe", "figma"])}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Install selected (2)");
  });

  test("shows back button", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).toContain("Back to categories");
  });

  test("shows selected summary when connectors are selected", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set(["stripe", "anthropic"])}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Selected:");
    expect(frame).toContain("stripe");
    expect(frame).toContain("anthropic");
  });

  test("shows help text", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("navigate");
    expect(frame).toContain("toggle");
    expect(frame).toContain("install");
  });

  test("handles empty connectors list", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={[]}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Back to categories");
    expect(frame).toContain("Install selected (0)");
  });

  test("handles cursor navigation with keyboard", () => {
    const { lastFrame, stdin } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    // Press down arrow to move cursor
    stdin.write("\x1B[B"); // down arrow
    const frame = lastFrame();
    // Cursor should be on first connector row (stripe)
    expect(frame).toContain("stripe");
  });

  test("renders separator line", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).toContain("─");
  });

  test("renders cursor indicator on first item", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    // First item (back) should have the cursor
    expect(lastFrame()).toContain("❯");
  });

  test("shows no selected summary when nothing selected", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).not.toContain("Selected:");
  });
});
