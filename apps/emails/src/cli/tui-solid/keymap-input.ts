import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { defaultEventMatchResolver } from "@opentui/keymap/addons";
import type { CliRenderer } from "@opentui/core";

export function createEmailsKeymap(renderer: CliRenderer) {
  const keymap = createDefaultOpenTuiKeymap(renderer);
  // OpenTUI can emit unnamed keys for unknown terminal sequences, or whitespace
  // characters that the keymap normalizer trims to nothing. They have no shortcut
  // identity. Leave the event untouched so focused inputs still receive text.
  keymap.clearEventMatchResolvers();
  keymap.appendEventMatchResolver((event, context) =>
    event.name.trim() ? defaultEventMatchResolver(event, context) : [],
  );
  return keymap;
}
