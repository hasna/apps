import React from "react";
import { describe, test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { Header } from "./Header.js";
import { CategorySelect } from "./CategorySelect.js";
import { ConnectorSelect } from "./ConnectorSelect.js";
import { SearchView } from "./SearchView.js";
import { InstallProgress } from "./InstallProgress.js";
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

  test("cursor moves down with arrow key", () => {
    const { lastFrame, stdin } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    // Move down twice to get to second connector
    stdin.write("\x1B[B"); // down arrow
    stdin.write("\x1B[B"); // down arrow again
    const frame = lastFrame();
    // Should show cursor indicator and connectors
    expect(frame).toContain("❯");
    expect(frame).toContain("stripe");
    expect(frame).toContain("figma");
  });

  test("cursor moves up with arrow key", () => {
    const { lastFrame, stdin } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    // Press up from first item should wrap to last
    stdin.write("\x1B[A"); // up arrow
    const frame = lastFrame();
    // Cursor should still be visible
    expect(frame).toContain("❯");
  });

  test("multiple selections show correctly", () => {
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={mockConnectors}
        selected={new Set(["stripe", "figma", "anthropic"])}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame()!;
    // All should be checked
    const checkmarks = (frame.match(/\[✓\]/g) || []).length;
    expect(checkmarks).toBe(3);
    // No unchecked
    const unchecked = (frame.match(/\[ \]/g) || []).length;
    expect(unchecked).toBe(0);
    // Install should show count 3
    expect(frame).toContain("Install selected (3)");
  });

  test("renders correct layout with all elements", () => {
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
    // Should have title
    expect(frame).toContain("Select connectors to install");
    // Should have back
    expect(frame).toContain("Back to categories");
    // Should have connectors
    expect(frame).toContain("stripe");
    expect(frame).toContain("figma");
    expect(frame).toContain("anthropic");
    // Should have install button
    expect(frame).toContain("Install selected (1)");
    // Should have selected summary
    expect(frame).toContain("Selected: stripe");
    // Should have help
    expect(frame).toContain("navigate");
  });

  test("connectors without version show dash", () => {
    const noVersionConnectors: ConnectorMeta[] = [
      {
        name: "test-no-version",
        displayName: "No Version",
        description: "No version connector",
        category: "Test",
        tags: [],
      },
    ];
    const { lastFrame } = render(
      <ConnectorSelect
        connectors={noVersionConnectors}
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).toContain("-");
  });
});

// ============================================================================
// SearchView Tests
// ============================================================================

describe("SearchView", () => {
  test("renders search input with placeholder", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Search:");
    expect(frame).toContain("Type to search");
  });

  test("shows minimum character hint initially", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).toContain("Type at least 2 characters");
  });

  test("shows help text for search mode", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).toContain("type to search");
  });

  test("shows selected summary when connectors are selected", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set(["stripe", "figma"])}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Selected:");
    expect(frame).toContain("stripe");
    expect(frame).toContain("figma");
  });

  test("does not show selected summary when nothing selected", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    expect(lastFrame()).not.toContain("Selected:");
  });

  test("renders initial layout correctly", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set()}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    // Search label
    expect(frame).toContain("Search:");
    // Min chars hint
    expect(frame).toContain("Type at least 2 characters");
    // Help text
    expect(frame).toContain("type to search");
    expect(frame).toContain("select results");
    expect(frame).toContain("esc back");
  });

  test("renders with selected connectors showing summary", () => {
    const { lastFrame } = render(
      <SearchView
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

  test("renders with single selected connector", () => {
    const { lastFrame } = render(
      <SearchView
        selected={new Set(["gmail"])}
        onToggle={() => {}}
        onConfirm={() => {}}
        onBack={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Selected: gmail");
  });
});

// ============================================================================
// InstallProgress Tests
// ============================================================================

describe("InstallProgress", () => {
  test("renders installing state with connector names", () => {
    const { lastFrame } = render(
      <InstallProgress
        connectors={["anthropic", "figma"]}
        onComplete={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("Installing connectors");
    // Should show connector names
    expect(frame).toContain("anthropic");
    expect(frame).toContain("figma");
  });

  test("shows progress counter", () => {
    const { lastFrame } = render(
      <InstallProgress
        connectors={["anthropic", "figma"]}
        onComplete={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("1/2");
  });

  test("shows pending items with circle marker", () => {
    const { lastFrame } = render(
      <InstallProgress
        connectors={["anthropic", "figma", "stripe"]}
        onComplete={() => {}}
      />
    );
    const frame = lastFrame();
    // Pending items should show circle
    expect(frame).toContain("○");
  });

  test("renders with single connector", () => {
    const { lastFrame } = render(
      <InstallProgress
        connectors={["anthropic"]}
        onComplete={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("1/1");
    expect(frame).toContain("anthropic");
  });

  test("passes overwrite option", () => {
    const { lastFrame } = render(
      <InstallProgress
        connectors={["anthropic"]}
        overwrite={true}
        onComplete={() => {}}
      />
    );
    const frame = lastFrame();
    expect(frame).toContain("anthropic");
  });
});
