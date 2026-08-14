import type { EmailProvider } from "./interface.ts";
import { ConsoleEmailProvider } from "./providers/console.ts";

let _provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (_provider) return _provider;

  const name = process.env["EMAIL_PROVIDER"] ?? "console";

  switch (name) {
    case "ses": {
      const { SESEmailProvider } = require("./providers/ses.ts") as { SESEmailProvider: new () => EmailProvider };
      _provider = new SESEmailProvider();
      break;
    }
    case "resend": {
      const { ResendEmailProvider } = require("./providers/resend.ts") as { ResendEmailProvider: new () => EmailProvider };
      _provider = new ResendEmailProvider();
      break;
    }
    case "smtp": {
      const { SMTPEmailProvider } = require("./providers/smtp.ts") as { SMTPEmailProvider: new () => EmailProvider };
      _provider = new SMTPEmailProvider();
      break;
    }
    default:
      _provider = new ConsoleEmailProvider();
  }

  return _provider;
}

/** Override provider (useful for tests) */
export function setEmailProvider(provider: EmailProvider): void {
  _provider = provider;
}

export type { EmailProvider, SendEmailOptions, SendResult } from "./interface.ts";
