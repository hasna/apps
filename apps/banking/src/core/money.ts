export type CurrencyCode = Uppercase<string>;

export interface Money {
  readonly currency: CurrencyCode;
  readonly amountMinor: string;
  readonly scale: number;
}

const DEFAULT_CURRENCY_SCALE: Readonly<Record<string, number>> = {
  EUR: 2,
  GBP: 2,
  RON: 2,
  USD: 2,
};

export function currencyScale(currency: CurrencyCode): number {
  return DEFAULT_CURRENCY_SCALE[currency] ?? 2;
}

export function moneyFromMinor(amountMinor: string | number | bigint, currency: CurrencyCode, scale = currencyScale(currency)): Money {
  const normalized = String(amountMinor);
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error("Money minor units must be an integer string.");
  }
  if (scale < 0 || !Number.isInteger(scale)) {
    throw new Error("Money scale must be a non-negative integer.");
  }
  return { currency, amountMinor: normalized, scale };
}

export function moneyFromDecimal(amount: string, currency: CurrencyCode, scale = currencyScale(currency)): Money {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) {
    throw new Error("Money amount must be a decimal string.");
  }

  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) {
    throw new Error(`Money amount has more than ${scale} decimal places for ${currency}.`);
  }

  const paddedFraction = fraction.padEnd(scale, "0");
  const minor = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "") || "0";
  return moneyFromMinor(`${negative && minor !== "0" ? "-" : ""}${minor}`, currency, scale);
}

export function formatMoney(money: Money): string {
  const negative = money.amountMinor.startsWith("-");
  const unsigned = negative ? money.amountMinor.slice(1) : money.amountMinor;
  const padded = unsigned.padStart(money.scale + 1, "0");
  const whole = padded.slice(0, padded.length - money.scale);
  const fraction = money.scale === 0 ? "" : `.${padded.slice(-money.scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction} ${money.currency}`;
}

export function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency || left.scale !== right.scale) {
    throw new Error("Money values must use the same currency and scale.");
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return moneyFromMinor(BigInt(left.amountMinor) + BigInt(right.amountMinor), left.currency, left.scale);
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  const a = BigInt(left.amountMinor);
  const b = BigInt(right.amountMinor);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isPositiveMoney(money: Money): boolean {
  return BigInt(money.amountMinor) > 0n;
}
