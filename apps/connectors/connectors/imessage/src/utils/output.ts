import chalk from 'chalk';
import type { IMessageHealth, IMessageConversation, IMessage, IMessageContact } from '../types';

export type OutputFormat = 'json' | 'pretty';

function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function output(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(formatJson(data));
    return;
  }

  // Pretty output
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(chalk.dim('No results'));
      return;
    }
    data.forEach((item) => outputSingle(item));
  } else {
    outputSingle(data);
  }
}

function outputSingle(data: unknown): void {
  if (isHealth(data)) {
    outputHealth(data);
  } else if (isConversation(data)) {
    outputConversation(data);
  } else if (isMessage(data)) {
    outputMessage(data);
  } else if (isContact(data)) {
    outputContact(data);
  } else {
    console.log(formatJson(data));
  }
}

function isHealth(data: unknown): data is IMessageHealth {
  return typeof data === 'object' && data !== null && 'bridge' in data && 'imessage' in data;
}

function outputHealth(health: IMessageHealth): void {
  const statusColor =
    health.status === 'healthy'
      ? chalk.green
      : health.status === 'degraded'
        ? chalk.yellow
        : chalk.red;

  console.log(chalk.bold('iMessage Bridge Status'));
  console.log('');
  console.log('  Status:', statusColor(health.status));
  console.log('');
  console.log(chalk.bold('  Bridge:'));
  console.log('    Reachable:', health.bridge.reachable ? chalk.green('Yes') : chalk.red('No'));
  if (health.bridge.version) console.log('    Version:', health.bridge.version);
  if (health.bridge.platform) console.log('    Platform:', health.bridge.platform);
  if (health.bridge.lastSeen) console.log('    Last Seen:', health.bridge.lastSeen);
  console.log('');
  console.log(chalk.bold('  iMessage:'));
  console.log('    Signed In:', health.imessage.signedIn ? chalk.green('Yes') : chalk.red('No'));
  if (health.imessage.account) console.log('    Account:', health.imessage.account);
  console.log('');
  console.log('  Timestamp:', health.timestamp);
}

function isConversation(data: unknown): data is IMessageConversation {
  return typeof data === 'object' && data !== null && 'chatIdentifier' in data;
}

function outputConversation(conv: IMessageConversation): void {
  console.log(chalk.bold(conv.displayName || conv.chatIdentifier));
  console.log('  ID:', conv.id);
  console.log('  Type:', conv.type);
  if (conv.participants?.length) {
    console.log('  Participants:', conv.participants.map((p) => p.name || p.handle).join(', '));
  }
  if (conv.lastMessage?.text) {
    const prefix = conv.lastMessage.fromMe ? chalk.dim('You:') : chalk.dim('');
    console.log('  Last:', prefix, conv.lastMessage.text.substring(0, 80));
  }
  if (conv.unreadCount && conv.unreadCount > 0) {
    console.log('  Unread:', chalk.yellow(conv.unreadCount));
  }
  console.log('');
}

function isMessage(data: unknown): data is IMessage {
  return typeof data === 'object' && data !== null && 'guid' in data && 'fromMe' in data;
}

function outputMessage(msg: IMessage): void {
  const sender = msg.fromMe ? chalk.cyan('You') : chalk.green(msg.displayName || msg.handle || 'Unknown');
  const arrow = msg.fromMe ? '→' : '←';
  console.log(`${sender} ${arrow} ${msg.text || '(no text)'}`);
  console.log('  Date:', msg.date);
  if (msg.attachments?.length) {
    console.log('  Attachments:', msg.attachments.length);
  }
  console.log('');
}

function isContact(data: unknown): data is IMessageContact {
  return typeof data === 'object' && data !== null && 'handle' in data;
}

function outputContact(contact: IMessageContact): void {
  console.log(chalk.bold(contact.name || contact.handle));
  console.log('  Handle:', contact.handle);
  if (contact.phoneNumbers?.length) {
    console.log('  Phones:', contact.phoneNumbers.join(', '));
  }
  if (contact.emails?.length) {
    console.log('  Emails:', contact.emails.join(', '));
  }
  console.log('');
}
