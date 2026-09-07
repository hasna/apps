/**
 * Hermetic store environment for tests that drive the LIVE `process.env`.
 *
 * WHY THIS EXISTS (hasna/apps#1720 validation). The on-box SQLite store is
 * reachable only through the explicit opt-in `HASNA_TELEPHONY_LOCAL=1`, and
 * that opt-in YIELDS to any resolved credential — by design, a Keychain item
 * or a credentials file outranks it and selects the hosted API. A test that
 * merely sets the opt-in on the live environment is therefore hermetic only on
 * a machine with NO telephony credential: on a station whose Keychain holds
 * `hasna.credentials.telephony.api-key` — or whose
 * `~/.hasna/telephony/config/credentials` file does — the shared
 * @hasna/contracts resolver (which consults the ambient tiers for the live
 * `process.env`, and only for it) resolves the fleet key, the opt-in yields,
 * and `bun test` transacts against the live fleet. It did: two
 * `SMsignedreplay` fixture rows reached the hosted service from the serve
 * suite before this helper existed.
 *
 * The ambient tiers are neutralised, never disabled: the Keychain tier stays
 * on (the resolver's identity gate is untouched) but looks up an account that
 * cannot exist — `HASNA_STATION` is the documented first input of the account
 * derivation (`HASNA_STATION` → `hostname -s` → `USER`) — and the disk tier
 * reads `<HASNA_HOME>/telephony/config/credentials` under an empty temporary
 * root. Every deliberate pointer (`HASNA_TELEPHONY_API_KEY_OVERRIDE`,
 * `HASNA_PROFILE`, `HASNA_TELEPHONY_API_KEY_REF`) and env-tier variable is
 * cleared. A leak fails LOUDLY: {@link assertLocalStore} refuses to let a
 * suite continue when anything still resolved a credential, instead of
 * letting fixtures land somewhere else.
 */
import { join } from "node:path";
import { telephonyAuthorityEnvKeys } from "../../src/lib/client-transport.js";
import { getStore } from "../../src/lib/store/index.js";

/** A Keychain account that cannot exist on any station: the `security` lookup misses deterministically. */
export const HERMETIC_STATION = "telephony-test-no-keychain";

/** Every live-env name the store resolver, the data-home resolver, or the opt-in reads. */
export const HERMETIC_STORE_ENV_NAMES: readonly string[] = Object.freeze([
  ...telephonyAuthorityEnvKeys(),
  "HASNA_TELEPHONY_LOCAL",
  "TELEPHONY_LOCAL",
  "HASNA_TELEPHONY_STORAGE_MODE",
  "HASNA_TELEPHONY_MODE",
  "TELEPHONY_STORAGE_MODE",
  "TELEPHONY_MODE",
  "HASNA_TELEPHONY_DB_PATH",
  "TELEPHONY_DB_PATH",
  "HASNA_DATA_HOME",
  "HASNA_STATION",
  "HASNA_HOME",
  "HASNA_CONFIG_HOME",
]);

/**
 * Snapshot the live values of the hermetic names (plus any extras) and return
 * the function that puts them back exactly — deleted where they were absent.
 */
export function snapshotStoreEnv(extraNames: readonly string[] = []): () => void {
  const names = [...HERMETIC_STORE_ENV_NAMES, ...extraNames];
  const saved = new Map(names.map((name) => [name, process.env[name]] as const));
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

/**
 * The child-process env overrides that make a spawned telephony bin hermetic
 * against the machine's credential stores. The disk tier lands under the
 * given scratch home, the Keychain tier misses on the sentinel account.
 */
export function hermeticChildEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    HASNA_STATION: HERMETIC_STATION,
    HASNA_HOME: join(home, ".hasna"),
  };
}

/**
 * Point every credential tier the resolver reads at the temporary root and
 * clear the rest, WITHOUT choosing a transport: no opt-in, no env pair. The
 * caller then either opts into the on-box store ({@link optInLocalStore}) or
 * configures a loopback authority + env key of its own.
 */
export function isolateStoreEnv(root: string): void {
  for (const name of HERMETIC_STORE_ENV_NAMES) delete process.env[name];
  process.env.HASNA_STATION = HERMETIC_STATION;
  process.env.HASNA_HOME = join(root, "hasna-home");
  process.env.HASNA_DATA_HOME = join(root, "data");
  process.env.HASNA_TELEPHONY_DB_PATH = join(root, "telephony.db");
}

/**
 * Select the on-box store for the process the only legitimate way — the
 * explicit opt-in on an environment where nothing else can resolve — and
 * prove it took: the store MUST report the local transport.
 */
export function optInLocalStore(root: string): void {
  isolateStoreEnv(root);
  process.env.HASNA_TELEPHONY_LOCAL = "1";
  assertLocalStore();
}

/** Refuse to run a local-store suite against anything but the LocalStore. */
export function assertLocalStore(): void {
  const transport = getStore().transport;
  if (transport !== "local") {
    throw new Error(
      `hermetic leak: the telephony store resolved to the "${transport}" transport although ` +
        `HASNA_TELEPHONY_LOCAL=1 is set — a credential outranked the opt-in (the opt-in yields by design). ` +
        `Refusing to run this suite against a live service. Check HASNA_STATION=${process.env.HASNA_STATION ?? "<unset>"} ` +
        `and HASNA_HOME=${process.env.HASNA_HOME ?? "<unset>"}.`,
    );
  }
}