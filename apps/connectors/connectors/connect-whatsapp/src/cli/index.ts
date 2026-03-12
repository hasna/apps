#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WhatsApp } from '../api';
import type { WhatsAppConfig, OutputFormat } from '../types';
import {
  getAccessToken,
  setAccessToken,
  getPhoneNumberId,
  setPhoneNumberId,
  getBusinessAccountId,
  setBusinessAccountId,
  clearConfig,
  getConfigDir,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  setProfileOverride,
  getActiveProfileName,
} from '../utils/config';

const program = new Command();

function getClient(): WhatsApp {
  const accessToken = getAccessToken();
  const phoneNumberId = getPhoneNumberId();

  if (!accessToken) {
    console.error(chalk.red('Error: Access token not configured.'));
    console.error(chalk.yellow('Run: connect-whatsapp config set-token <access-token>'));
    console.error(chalk.yellow('Or set WHATSAPP_ACCESS_TOKEN environment variable'));
    process.exit(1);
  }

  if (!phoneNumberId) {
    console.error(chalk.red('Error: Phone number ID not configured.'));
    console.error(chalk.yellow('Run: connect-whatsapp config set-phone <phone-number-id>'));
    console.error(chalk.yellow('Or set WHATSAPP_PHONE_NUMBER_ID environment variable'));
    process.exit(1);
  }

  const config: WhatsAppConfig = {
    accessToken,
    phoneNumberId,
    businessAccountId: getBusinessAccountId(),
  };
  return new WhatsApp(config);
}

function formatOutput(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

// ============================================
// Profile Commands
// ============================================

const profileCmd = new Command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured.'));
      console.log(chalk.gray('Create one with: connect-whatsapp profile create <name>'));
      return;
    }

    console.log(chalk.bold('Profiles:'));
    for (const profile of profiles) {
      const marker = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('current')
  .description('Show current active profile')
  .action(() => {
    const current = getCurrentProfile();
    console.log(current);
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      console.log(chalk.green(`Switched to profile: ${name}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      const created = createProfile(name);
      if (created) {
        console.log(chalk.green(`Created profile: ${name}`));
      } else {
        console.log(chalk.yellow(`Profile already exists: ${name}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    const deleted = deleteProfile(name);
    if (deleted) {
      console.log(chalk.green(`Deleted profile: ${name}`));
    } else {
      console.log(chalk.yellow(`Could not delete profile: ${name}`));
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profile = loadProfile(name);
    const profileName = name || getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}`));
    console.log(chalk.gray('Access Token:'), profile.accessToken ? '***configured***' : 'not set');
    console.log(chalk.gray('Phone Number ID:'), profile.phoneNumberId || 'not set');
    console.log(chalk.gray('Business Account ID:'), profile.businessAccountId || 'not set');
  });

// ============================================
// Config Commands
// ============================================

const configCmd = new Command('config')
  .description('Manage configuration');

configCmd
  .command('set-token <accessToken>')
  .description('Set the access token for current profile')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    const profile = getActiveProfileName();
    console.log(chalk.green(`Access token saved to profile: ${profile}`));
  });

configCmd
  .command('set-phone <phoneNumberId>')
  .description('Set the phone number ID for current profile')
  .action((phoneNumberId: string) => {
    setPhoneNumberId(phoneNumberId);
    const profile = getActiveProfileName();
    console.log(chalk.green(`Phone number ID saved to profile: ${profile}`));
  });

configCmd
  .command('set-business <businessAccountId>')
  .description('Set the business account ID for current profile')
  .action((businessAccountId: string) => {
    setBusinessAccountId(businessAccountId);
    const profile = getActiveProfileName();
    console.log(chalk.green(`Business account ID saved to profile: ${profile}`));
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const accessToken = getAccessToken();
    const phoneNumberId = getPhoneNumberId();
    const businessAccountId = getBusinessAccountId();
    const configDir = getConfigDir();

    console.log(chalk.bold('Current Configuration:'));
    console.log(chalk.gray('Profile:'), profile);
    console.log(chalk.gray('Config directory:'), configDir);
    console.log(chalk.gray('Access Token:'), accessToken ? '***configured***' : 'not set');
    console.log(chalk.gray('Phone Number ID:'), phoneNumberId || 'not set');
    console.log(chalk.gray('Business Account ID:'), businessAccountId || 'not set');
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Configuration cleared.'));
  });

configCmd
  .command('path')
  .description('Show configuration directory path')
  .action(() => {
    console.log(getConfigDir());
  });

// ============================================
// Message Commands
// ============================================

const messageCmd = new Command('message')
  .description('Send messages');

messageCmd
  .command('text <to> <text>')
  .description('Send a text message')
  .option('--preview', 'Enable URL preview')
  .option('-r, --reply-to <messageId>', 'Reply to message ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (to: string, text: string, options) => {
    try {
      const client = getClient();
      const result = await client.sendText(to, text, {
        previewUrl: options.preview,
        replyToMessageId: options.replyTo,
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.green('Message sent.'));
        if (result.messages && result.messages.length > 0) {
          console.log(chalk.gray('Message ID:'), result.messages[0].id);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

messageCmd
  .command('image <to> <urlOrId>')
  .description('Send an image (URL or media ID)')
  .option('-c, --caption <caption>', 'Image caption')
  .option('-r, --reply-to <messageId>', 'Reply to message ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (to: string, urlOrId: string, options) => {
    try {
      const client = getClient();
      const media = urlOrId.startsWith('http') ? { link: urlOrId, caption: options.caption } : { id: urlOrId, caption: options.caption };
      const result = await client.sendImage(to, media, {
        replyToMessageId: options.replyTo,
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.green('Image sent.'));
        if (result.messages && result.messages.length > 0) {
          console.log(chalk.gray('Message ID:'), result.messages[0].id);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

messageCmd
  .command('document <to> <urlOrId>')
  .description('Send a document (URL or media ID)')
  .option('-c, --caption <caption>', 'Document caption')
  .option('-n, --filename <filename>', 'File name')
  .option('-r, --reply-to <messageId>', 'Reply to message ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (to: string, urlOrId: string, options) => {
    try {
      const client = getClient();
      const media = urlOrId.startsWith('http')
        ? { link: urlOrId, caption: options.caption, filename: options.filename }
        : { id: urlOrId, caption: options.caption, filename: options.filename };
      const result = await client.sendDocument(to, media, {
        replyToMessageId: options.replyTo,
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.green('Document sent.'));
        if (result.messages && result.messages.length > 0) {
          console.log(chalk.gray('Message ID:'), result.messages[0].id);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

messageCmd
  .command('location <to> <latitude> <longitude>')
  .description('Send a location')
  .option('-n, --name <name>', 'Location name')
  .option('-a, --address <address>', 'Location address')
  .option('-r, --reply-to <messageId>', 'Reply to message ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (to: string, latitude: string, longitude: string, options) => {
    try {
      const client = getClient();
      const result = await client.sendLocation(to, {
        latitude: Number(latitude),
        longitude: Number(longitude),
        name: options.name,
        address: options.address,
      }, {
        replyToMessageId: options.replyTo,
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.green('Location sent.'));
        if (result.messages && result.messages.length > 0) {
          console.log(chalk.gray('Message ID:'), result.messages[0].id);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

messageCmd
  .command('template <to> <templateName> <languageCode>')
  .description('Send a template message')
  .option('-r, --reply-to <messageId>', 'Reply to message ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (to: string, templateName: string, languageCode: string, options) => {
    try {
      const client = getClient();
      const result = await client.sendTemplate(to, {
        name: templateName,
        language: { code: languageCode },
      }, {
        replyToMessageId: options.replyTo,
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.green('Template message sent.'));
        if (result.messages && result.messages.length > 0) {
          console.log(chalk.gray('Message ID:'), result.messages[0].id);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

messageCmd
  .command('react <to> <messageId> <emoji>')
  .description('React to a message')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (to: string, messageId: string, emoji: string, options) => {
    try {
      const client = getClient();
      const result = await client.sendReaction(to, {
        message_id: messageId,
        emoji,
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.green('Reaction sent.'));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

messageCmd
  .command('read <messageId>')
  .description('Mark a message as read')
  .action(async (messageId: string) => {
    try {
      const client = getClient();
      await client.markAsRead(messageId);
      console.log(chalk.green('Message marked as read.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Media Commands
// ============================================

const mediaCmd = new Command('media')
  .description('Manage media');

mediaCmd
  .command('get <mediaId>')
  .description('Get media URL')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (mediaId: string, options) => {
    try {
      const client = getClient();
      const result = await client.getMediaUrl(mediaId);

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.bold('Media:'));
        console.log(chalk.gray('ID:'), result.id);
        console.log(chalk.gray('URL:'), result.url);
        console.log(chalk.gray('MIME Type:'), result.mime_type);
        console.log(chalk.gray('Size:'), result.file_size);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

mediaCmd
  .command('delete <mediaId>')
  .description('Delete media')
  .action(async (mediaId: string) => {
    try {
      const client = getClient();
      await client.deleteMedia(mediaId);
      console.log(chalk.green('Media deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Business Profile Commands
// ============================================

const businessCmd = new Command('business')
  .description('Manage business profile');

businessCmd
  .command('get')
  .description('Get business profile')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.getBusinessProfile();

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        if (result.data && result.data.length > 0) {
          const profile = result.data[0];
          console.log(chalk.bold('Business Profile:'));
          if (profile.about) console.log(chalk.gray('About:'), profile.about);
          if (profile.address) console.log(chalk.gray('Address:'), profile.address);
          if (profile.description) console.log(chalk.gray('Description:'), profile.description);
          if (profile.email) console.log(chalk.gray('Email:'), profile.email);
          if (profile.vertical) console.log(chalk.gray('Industry:'), profile.vertical);
          if (profile.websites && profile.websites.length > 0) {
            console.log(chalk.gray('Websites:'), profile.websites.join(', '));
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

businessCmd
  .command('update')
  .description('Update business profile')
  .option('-a, --about <about>', 'About text')
  .option('--address <address>', 'Business address')
  .option('-d, --description <description>', 'Business description')
  .option('-e, --email <email>', 'Business email')
  .option('-v, --vertical <vertical>', 'Business vertical/industry')
  .action(async (options) => {
    try {
      const client = getClient();
      const profile: Record<string, string | string[] | undefined> = {};
      if (options.about) profile.about = options.about;
      if (options.address) profile.address = options.address;
      if (options.description) profile.description = options.description;
      if (options.email) profile.email = options.email;
      if (options.vertical) profile.vertical = options.vertical;

      await client.updateBusinessProfile(profile);
      console.log(chalk.green('Business profile updated.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Phone Number Commands
// ============================================

const phoneCmd = new Command('phone')
  .description('Manage phone numbers');

phoneCmd
  .command('get')
  .description('Get current phone number info')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.getPhoneNumber();

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.bold('Phone Number:'));
        console.log(chalk.gray('ID:'), result.id);
        console.log(chalk.gray('Display:'), result.display_phone_number);
        console.log(chalk.gray('Verified Name:'), result.verified_name);
        console.log(chalk.gray('Quality:'), result.quality_rating);
        console.log(chalk.gray('Status:'), result.code_verification_status);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

phoneCmd
  .command('list')
  .description('List all phone numbers')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listPhoneNumbers();

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        if (result.data.length === 0) {
          console.log(chalk.yellow('No phone numbers found.'));
          return;
        }
        console.log(chalk.bold(`Phone Numbers (${result.data.length}):\n`));
        for (const phone of result.data) {
          console.log(chalk.cyan(phone.display_phone_number));
          console.log(chalk.gray(`  ID: ${phone.id}`));
          console.log(chalk.gray(`  Name: ${phone.verified_name}`));
          console.log(chalk.gray(`  Quality: ${phone.quality_rating}`));
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Template Commands
// ============================================

const templateCmd = new Command('template')
  .description('Manage message templates');

templateCmd
  .command('list')
  .description('List message templates')
  .option('-l, --limit <limit>', 'Maximum number of templates', '25')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listTemplates({
        limit: parseInt(options.limit),
      });

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        if (result.data.length === 0) {
          console.log(chalk.yellow('No templates found.'));
          return;
        }
        console.log(chalk.bold(`Templates (${result.data.length}):\n`));
        for (const template of result.data) {
          const statusColor = template.status === 'APPROVED' ? chalk.green : template.status === 'PENDING' ? chalk.yellow : chalk.red;
          console.log(`${chalk.cyan(template.name)} ${statusColor(`[${template.status}]`)}`);
          console.log(chalk.gray(`  ID: ${template.id}`));
          console.log(chalk.gray(`  Category: ${template.category}`));
          console.log(chalk.gray(`  Language: ${template.language}`));
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

templateCmd
  .command('get <templateId>')
  .description('Get template details')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (templateId: string, options) => {
    try {
      const client = getClient();
      const result = await client.getTemplate(templateId);

      if (options.format === 'json') {
        formatOutput(result, 'json');
      } else {
        console.log(chalk.bold(result.name));
        console.log(chalk.gray('ID:'), result.id);
        console.log(chalk.gray('Status:'), result.status);
        console.log(chalk.gray('Category:'), result.category);
        console.log(chalk.gray('Language:'), result.language);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

templateCmd
  .command('delete <templateName>')
  .description('Delete a template')
  .action(async (templateName: string) => {
    try {
      const client = getClient();
      await client.deleteTemplate(templateName);
      console.log(chalk.green('Template deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Main Program
// ============================================

program
  .name('connect-whatsapp')
  .description('WhatsApp Business Cloud connector - Send messages, manage templates, and handle webhooks')
  .version('0.0.1')
  .option('--profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

program.addCommand(profileCmd);
program.addCommand(configCmd);
program.addCommand(messageCmd);
program.addCommand(mediaCmd);
program.addCommand(businessCmd);
program.addCommand(phoneCmd);
program.addCommand(templateCmd);

program.parse();
