import type { Store } from "../store/types.js";
import type { VaultItemKind, VaultItemMetadata, VaultItemPayload } from "../types.js";
import type { CliFlags } from "./args.js";

const VAULT_ITEM_KINDS: VaultItemKind[] = [
  "login",
  "address",
  "identity",
  "payment_card",
  "secure_note",
  "api_key",
  "custom",
];

function splitFlagList(value?: string): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function itemDomains(flags: CliFlags): string[] {
  return [
    ...splitFlagList(flags.domain),
    ...splitFlagList(flags.domains),
    ...(flags.url ? [flags.url] : []),
  ];
}

function requireFlag(flags: CliFlags, name: string, usageText: string): string {
  const value = flags[name]?.trim();
  if (!value) {
    console.error(usageText);
    process.exit(1);
  }
  return value;
}

function compactPayload(payload: VaultItemPayload): VaultItemPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function redactVaultPayload(data: VaultItemPayload): VaultItemPayload {
  const sensitive = new Set([
    "password",
    "totp",
    "cardNumber",
    "securityCode",
    "cvv",
    "secret",
    "token",
    "apiKey",
  ]);
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      sensitive.has(key) && value ? "***REDACTED***" : value,
    ])
  );
}

function formatVaultItem(item: VaultItemMetadata): string {
  const domains = item.domains.length ? ` ${item.domains.join(",")}` : "";
  const subtitle = item.subtitle ? ` - ${item.subtitle}` : "";
  const favorite = item.favorite ? " *" : "";
  return `${item.id} [${item.kind}]${favorite} ${item.title}${subtitle}${domains}`;
}

export async function runItemsCommand(
  store: () => Store,
  positional: string[],
  flags: CliFlags,
): Promise<void> {
  const [sub, idOrKind] = positional;
  switch (sub) {
    case "list": {
      const kind = idOrKind as VaultItemKind | undefined;
      if (kind && !VAULT_ITEM_KINDS.includes(kind)) {
        console.error(`Invalid kind "${kind}". Valid: ${VAULT_ITEM_KINDS.join(", ")}`);
        process.exit(1);
      }
      const items = await store().listVaultItemMetadata(kind);
      if ("json" in flags) {
        console.log(JSON.stringify(items, null, 2));
        break;
      }
      if (items.length === 0) {
        console.log(kind ? `No ${kind} vault items.` : "No structured vault items.");
      } else {
        for (const item of items) console.log(formatVaultItem(item));
        console.log(`\n${items.length} item(s)`);
      }
      break;
    }

    case "search": {
      const query = idOrKind;
      if (!query) { console.error("Usage: secrets items search <query>"); process.exit(1); }
      const items = await store().searchVaultItemMetadata(query);
      if ("json" in flags) {
        console.log(JSON.stringify(items, null, 2));
        break;
      }
      if (items.length === 0) {
        console.log(`No vault items for: ${query}`);
      } else {
        for (const item of items) console.log(formatVaultItem(item));
        console.log(`\n${items.length} item(s)`);
      }
      break;
    }

    case "get": {
      const id = idOrKind;
      if (!id) { console.error("Usage: secrets items get <id> [--show]"); process.exit(1); }
      const item = await store().getVaultItem(id);
      if (!item) { console.error(`Not found: ${id}`); process.exit(1); }
      console.log(JSON.stringify({
        ...item,
        data: flags.show === "true" ? item.data : redactVaultPayload(item.data),
      }, null, 2));
      break;
    }

    case "delete":
    case "rm":
    case "remove": {
      const id = idOrKind;
      if (!id) { console.error(`Usage: secrets items ${sub} <id>`); process.exit(1); }
      if (!await store().deleteVaultItem(id)) { console.error(`Not found: ${id}`); process.exit(1); }
      console.log(`✓ Deleted vault item: ${id}`);
      break;
    }

    case "add-login": {
      const title = requireFlag(flags, "title", "Usage: secrets items add-login --title <title> --url <url> --username <user> --password <pass>");
      const username = requireFlag(flags, "username", "Usage: secrets items add-login --title <title> --url <url> --username <user> --password <pass>");
      const password = requireFlag(flags, "password", "Usage: secrets items add-login --title <title> --url <url> --username <user> --password <pass>");
      const item = await store().setVaultItem({
        kind: "login",
        title,
        subtitle: username,
        domains: itemDomains(flags),
        tags: splitFlagList(flags.tags ?? flags.tag),
        favorite: flags.favorite === "true",
        data: compactPayload({
          username,
          password,
          url: flags.url,
          notes: flags.notes,
          totp: flags.totp,
        }),
      });
      console.log(`✓ Stored vault item: ${item.id} [${item.kind}] ${item.title}`);
      break;
    }

    case "add-address": {
      const title = requireFlag(flags, "title", "Usage: secrets items add-address --title <title> [--name <name>] [--line1 <line>] [--city <city>]");
      const item = await store().setVaultItem({
        kind: "address",
        title,
        subtitle: flags.name ?? flags.email ?? flags.phone,
        domains: itemDomains(flags),
        tags: splitFlagList(flags.tags ?? flags.tag),
        favorite: flags.favorite === "true",
        data: compactPayload({
          name: flags.name,
          givenName: flags["given-name"],
          familyName: flags["family-name"],
          organization: flags.organization ?? flags.company,
          addressLine1: flags.line1 ?? flags["address-line1"],
          addressLine2: flags.line2 ?? flags["address-line2"],
          city: flags.city,
          state: flags.state,
          postalCode: flags.postal ?? flags.zip ?? flags["postal-code"],
          country: flags.country,
          phone: flags.phone,
          email: flags.email,
        }),
      });
      console.log(`✓ Stored vault item: ${item.id} [${item.kind}] ${item.title}`);
      break;
    }

    case "add-note": {
      const title = requireFlag(flags, "title", "Usage: secrets items add-note --title <title> --body <text>");
      const body = requireFlag(flags, "body", "Usage: secrets items add-note --title <title> --body <text>");
      const item = await store().setVaultItem({
        kind: "secure_note",
        title,
        subtitle: flags.subtitle,
        domains: itemDomains(flags),
        tags: splitFlagList(flags.tags ?? flags.tag),
        favorite: flags.favorite === "true",
        data: { body },
      });
      console.log(`✓ Stored vault item: ${item.id} [${item.kind}] ${item.title}`);
      break;
    }

    default:
      console.error(`Unknown items subcommand: ${sub ?? ""}`);
      console.error("Usage: secrets items list|get|search|delete|add-login|add-address|add-note");
      process.exit(1);
  }
}
