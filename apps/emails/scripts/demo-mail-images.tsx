/** Synthetic image-only demo. No Emails API or real mail is accessed. */
import { createCliRenderer } from "@opentui/core";
import { render, testRender } from "@opentui/solid";
import { ThemeProvider } from "../src/cli/tui-solid/context/theme.js";
import {
  MessageImages,
  MailImagePreview,
} from "../src/cli/tui-solid/component/message-images.js";
const embedded =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAADtklEQVR4nBXPIQ7qBgAA0J1kYgKBQCAQiAoEAtEsCEQFolkQFRUIsiAQFQjyU4GoQDQLAlGBID+IigoEWRAVFQgyvWtsD/EO8H759fef//1Gjz4DhowYEzBhyoyQOQsilsSsSEhZs2HLjow9B3KOFJwoOXOh4sqNOzUND568aOl48+GXXyMBevQZMGTEmIAJU2aEzFkQsSRmRULKmg1bdmTsOZBzpOBEyZkLFVdu3KlpePDkRUvHm0/0DfwhQI8+A4aMGBMwYcqMkDkLIpbErEhIWbNhy46MPQdyjhScKDlzoeLKjTs1DQ+evGjpePP54xtIBejRZ8CQEWMCJkyZETJnQcSSmBUJKWs2bNmRsedAzpGCEyVnLlRcuXGnpuHBkxctHW8+6TfwpwA9+gwYMmJMwIQpM0LmLIhYErMiIWXNhi07MvYcyDlScKLkzIWKKzfu1DQ8ePKipePN589vIBOgR58BQ0aMCZgwZUbInAURS2JWJKSs2bBlR8aeAzlHCk6UnLlQceXGnZqGB09etHS8+WTfwA8BevQZMGTEmIAJU2aEzFkQsSRmRULKmg1bdmTsOZBzpOBEyZkLFVdu3KlpePDkRUvHm8+Pb6AQoEefAUNGjAmYMGVGyJwFEUtiViSkrNmwZUfGngM5RwpOlJy5UHHlxp2ahgdPXrR0vPkU38BfAvToM2DIiDEBE6bMCJmzIGJJzIqElDUbtuzI2HMg50jBiZIzFyqu3LhT0/DgyYuWjjefv76BSoAefQYMGTEmYMKUGSFzFkQsiVmRkLJmw5YdGXsO5BwpOFFy5kLFlRt3ahoePHnR0vHmU30DPwXo0WfAkBFjAiZMmREyZ0HEkpgVCSlrNmzZkbHnQM6RghMlZy5UXLlxp6bhwZMXLR1vPj+/gUaAHn0GDBkxJmDClBkhcxZELIlZkZCyZsOWHRl7DuQcKThRcuZCxZUbd2oaHjx50dLx5tN8A38L0KPPgCEjxgRMmDIjZM6CiCUxKxJS1mzYsiNjz4GcIwUnSs5cqLhy405Nw4MnL1o63nz+/gY6AXr0GTBkxJiACVNmhMxZELEkZkVCypoNW3Zk7DmQc6TgRMmZCxVXbtypaXjw5EVLx5tP9w38I0CPPgOGjBgTMGHKjJA5CyKWxKxISFmzYcuOjD0Hco4UnCg5c6Hiyo07NQ0Pnrxo6Xjz+ecb+FeAHn0GDBkxJmDClBkhcxZELIlZkZCyZsOWHRl7DuQcKThRcuZCxZUbd2oaHjx50dLx5sP/xj5eeU54dY8AAAAASUVORK5CYII=";
function Demo() {
  return (
    <ThemeProvider mode="light">
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        padding={1}
        backgroundColor="#ffffff"
      >
        <text fg="#1f2937">Emails · Native image preview</text>
        <text fg="#6b7280">
          Synthetic embedded image. Auto protocol uses Kitty/Sixel or Unicode
          blocks.
        </text>
        <MailImagePreview
          source={{
            kind: "embedded",
            data: embedded,
            label: "Fixture chart",
            inline: true,
          }}
        />
        <text fg="#1f2937">
          GitHub-style table images · click to expand; external requests stay
          blocked
        </text>
        <MessageImages
          html={
            '<table><tr><td><img alt="publish guard" src="https://images.example/guard.png"></td><td><img alt="test-suites" src="https://images.example/tests.png"></td></tr></table>'
          }
        />
        <text fg="#6b7280">Ctrl+C closes this demo.</text>
      </box>
    </ThemeProvider>
  );
}
const output = process.argv[2];
if (output) {
  const setup = await testRender(() => <Demo />, {
    width: 100,
    height: 32,
    useMouse: true,
    consoleMode: "disabled",
  });
  try {
    await setup.flush();
    await Bun.sleep(50);
    await setup.flush();
    await Bun.write(`${output}.txt`, setup.captureCharFrame());
    await Bun.write(`${output}.json`, JSON.stringify(setup.captureSpans()));
  } finally {
    setup.renderer.destroy();
  }
} else {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    consoleMode: "disabled",
  });
  await render(() => <Demo />, renderer);
}
