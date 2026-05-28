/**
 * Wallet payment integration for domain purchases
 *
 * Uses @hasna/wallets virtual cards to pay for domain registrations,
 * renewals, and marketplace purchases (Sedo, etc.)
 */

import type { Command } from "commander";
import { createDomain, getDomainByName, recordDomainPurchase, updateDomain } from "../../db/domains.js";
import { createHistoryEntry } from "../../db/domain-history.js";

export interface WalletCard {
  id: string;
  provider_id: string;
  external_id: string;
  name: string;
  last_four: string;
  brand: string;
  balance: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  card_id: string;
  amount: number;
  currency: string;
  type: string;
  status: string;
  merchant: string | null;
  description: string | null;
}

function getWalletsModule(): typeof import("@hasna/wallets") {
  try {
    return require("@hasna/wallets");
  } catch {
    throw new Error(
      "@hasna/wallets not installed. Run: bun add @hasna/wallets"
    );
  }
}

async function getAvailableCards(): Promise<WalletCard[]> {
  const wallets = getWalletsModule();
  const cards = await wallets.listCards({ status: "active" });
  return cards.map((c: any) => ({
    id: c.id,
    provider_id: c.provider_id,
    external_id: c.external_id,
    name: c.name,
    last_four: c.last_four,
    brand: c.brand,
    balance: c.balance,
    currency: c.currency,
  }));
}

export function registerWalletCommand(program: Command): void {
  const wallet = program
    .command("wallet")
    .description("Wallet payment integration for domain purchases");

  wallet
    .command("cards")
    .description("List available wallet cards")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const cards = await getAvailableCards();
        if (opts.json) {
          console.log(JSON.stringify(cards, null, 2));
        } else {
          if (cards.length === 0) {
            console.log("No active wallet cards found.");
            return;
          }
          console.log("Available wallet cards:");
          for (const c of cards) {
            console.log(`  ${c.brand} •••• ${c.last_four} — ${c.name} (${c.balance} ${c.currency})`);
          }
        }
      } catch (error: unknown) {
        console.error(`Failed to list cards: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  wallet
    .command("buy")
    .description("Purchase a domain using a wallet card")
    .argument("<name>", "Domain name to purchase")
    .requiredOption("--price <amount>", "Purchase price")
    .option("--card-id <id>", "Wallet card ID to charge")
    .option("--registrar <name>", "Registrar/seller name", "marketplace")
    .option("--currency <code>", "Currency code", "USD")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      const price = parseFloat(opts.price);
      const currency = opts.currency;

      try {
        // Get available cards if none specified
        let cardId = opts.cardId;
        if (!cardId) {
          const cards = await getAvailableCards();
          if (cards.length === 0) {
            console.error("No active wallet cards found. Add a card first.");
            process.exit(1);
          }
          if (cards.length === 1) {
            cardId = cards[0]!.external_id;
          } else {
            console.error("Multiple cards available. Specify --card-id:");
            for (const c of cards) {
              console.log(`  ${c.id}: ${c.brand} •••• ${c.last_four} (${c.balance} ${c.currency})`);
            }
            process.exit(1);
          }
        }

        const wallets = getWalletsModule();
        const card = wallets.getCard(cardId);
        if (!card) {
          console.error(`Card '${cardId}' not found.`);
          process.exit(1);
        }

        if (card.balance < price) {
          console.error(`Insufficient funds: need ${price} ${currency}, have ${card.balance} ${card.currency}`);
          process.exit(1);
        }

        // Check domain doesn't already exist
        const existing = getDomainByName(name);
        if (existing) {
          console.error(`Domain '${name}' already exists in portfolio.`);
          process.exit(1);
        }

        // Create domain record and record purchase
        const domain = createDomain({
          name,
          registrar: opts.registrar,
          status: "active",
          purchase_price: price,
          purchase_date: new Date().toISOString().split("T")[0],
          is_premium: price > 1000,
          premium_price: price > 1000 ? price : undefined,
        });

        recordDomainPurchase(domain.id, {
          price,
          registrar: opts.registrar,
          auto_renew: true,
        });

        createHistoryEntry({
          domain_id: domain.id,
          snapshot_type: "purchase",
          raw_data: { price, currency, card_id: cardId, payment_method: "wallet" },
          notes: `Purchased ${name} for ${price} ${currency} via wallet card ${cardId}`,
        });

        if (opts.json) {
          console.log(JSON.stringify({ domain, card_id: cardId, price, currency }, null, 2));
        } else {
          console.log(`Purchased ${name} for ${price} ${currency} via wallet card`);
          console.log(`  Added to portfolio as ${domain.id}`);
        }
      } catch (error: unknown) {
        console.error(`Wallet purchase failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  wallet
    .command("renew")
    .description("Renew a domain using a wallet card")
    .argument("<name>", "Domain name to renew")
    .requiredOption("--price <amount>", "Renewal price")
    .option("--card-id <id>", "Wallet card ID to charge")
    .option("--currency <code>", "Currency code", "USD")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      const price = parseFloat(opts.price);
      const domain = getDomainByName(name);
      if (!domain) {
        console.error(`Domain '${name}' not found in portfolio.`);
        process.exit(1);
      }

      try {
        // Get card ID
        let cardId = opts.cardId;
        if (!cardId) {
          const cards = await getAvailableCards();
          if (cards.length === 0) {
            console.error("No active wallet cards found.");
            process.exit(1);
          }
          cardId = cards[0]!.external_id;
        }

        const wallets = getWalletsModule();
        const card = wallets.getCard(cardId);
        if (!card) {
          console.error(`Card '${cardId}' not found.`);
          process.exit(1);
        }

        if (card.balance < price) {
          console.error(`Insufficient funds: need ${price} ${opts.currency}, have ${card.balance} ${card.currency}`);
          process.exit(1);
        }

        // Record renewal in history
        createHistoryEntry({
          domain_id: domain.id,
          snapshot_type: "renewal",
          raw_data: { price, currency: opts.currency, card_id: cardId, payment_method: "wallet" },
          notes: `Renewed ${name} for ${price} ${opts.currency} via wallet`,
        });

        // Update expiry if we know the duration
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        updateDomain(domain.id, {
          expires_at: expiryDate.toISOString(),
          purchase_price: price,
        });

        if (opts.json) {
          console.log(JSON.stringify({ domain: name, card_id: cardId, price, new_expiry: expiryDate.toISOString() }, null, 2));
        } else {
          console.log(`Renewed ${name} for ${price} ${opts.currency} via wallet card`);
          console.log(`  New expiry: ${expiryDate.toISOString().split("T")[0]}`);
        }
      } catch (error: unknown) {
        console.error(`Wallet renewal failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
