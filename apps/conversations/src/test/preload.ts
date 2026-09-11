/**
 * Test-run preload (bunfig.toml [test].preload): every test — and every CLI/MCP
 * process a test spawns with an inherited or hermetic env — runs against a
 * throw-away HOME. The package's own suites used to write `agent-id`, fixture
 * session identities, exports and a `messages.db` into the operator's real
 * `~/.hasna/conversations` (fleet-alignment T6-G5); with this preload the real
 * home is never the resolved home during `bun test`.
 *
 * Only the HOME anchor is pinned here (home overrides are cleared). Credential
 * and authority variables are handled per test by `enterHermeticTestEnv`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "conversations-test-home-"));
process.env.HOME = home;
// Only HOME is pinned: the @hasna/contracts chain and src/lib/home.ts derive
// `~/.hasna` from it, and an exported HASNA_HOME would out-rank the HOME a
// loopback fixture hands its spawned CLI (the fixture writes the credential
// file under ITS home). Ambient overrides are cleared so nothing on the
// operator's shell can redirect a test to a real home.
delete process.env.HASNA_HOME;
delete process.env.HASNA_CONVERSATIONS_HOME;
delete process.env.CONVERSATIONS_HOME;
delete process.env.XDG_CONFIG_HOME;
delete process.env.XDG_DATA_HOME;
delete process.env.XDG_STATE_HOME;
delete process.env.XDG_CACHE_HOME;
delete process.env.HASNA_DATA_HOME;
delete process.env.HASNA_CONFIG_HOME;
delete process.env.HASNA_STATE_HOME;
delete process.env.HASNA_CACHE_HOME;
