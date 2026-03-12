export function generateGitHubActionsWorkflow(): string {
  return `name: AI QA Tests
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install -g @hasna/testers
      - run: testers install-browser
      - run: testers run \${{ env.TEST_URL }} --json --output results.json
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          TEST_URL: \${{ vars.TEST_URL || 'http://localhost:3000' }}
      - run: testers report --latest --output report.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report
          path: |
            report.html
            results.json
`;
}
