#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Amadeus } from '../api';
import {
  getApiKey,
  getApiSecret,
  getEnvironment,
  setCredentials,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, printFlightOffers, printLocations, printDestinations } from '../utils/output';

const CONNECTOR_NAME = 'connect-amadeus';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Amadeus API connector - Flight search, booking, and travel data')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error('Profile "' + opts.profile + '" does not exist');
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Amadeus {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();

  if (!apiKey || !apiSecret) {
    error('No API credentials configured. Run "' + CONNECTOR_NAME + ' config set-credentials <apiKey> <apiSecret>"');
    process.exit(1);
  }

  return new Amadeus({
    apiKey,
    apiSecret,
    environment: getEnvironment(),
  });
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log('  ' + p + isActive);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error('Profile "' + name + '" does not exist');
    process.exit(1);
  }
  setCurrentProfile(name);
  success('Switched to profile: ' + name);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--api-key <key>', 'Amadeus API Key')
  .option('--api-secret <secret>', 'Amadeus API Secret')
  .option('--env <environment>', 'Environment (test/production)', 'test')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error('Profile "' + name + '" already exists');
      process.exit(1);
    }
    createProfile(name, {
      apiKey: opts.apiKey,
      apiSecret: opts.apiSecret,
      environment: opts.env,
    });
    success('Profile "' + name + '" created');
    if (opts.use) {
      setCurrentProfile(name);
      info('Switched to profile: ' + name);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success('Profile "' + name + '" deleted');
  } else {
    error('Profile "' + name + '" not found');
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold('Profile: ' + profileName + (profileName === active ? chalk.green(' (active)') : '')));
  info('API Key: ' + (config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')));
  info('API Secret: ' + (config.apiSecret ? '********' : chalk.gray('not set')));
  info('Environment: ' + (config.environment || 'test'));
});

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-credentials <apiKey> <apiSecret>').description('Set Amadeus API credentials')
  .option('--env <environment>', 'Environment (test/production)', 'test')
  .action((apiKey: string, apiSecret: string, opts) => {
    setCredentials(apiKey, apiSecret, opts.env);
    success('Credentials saved to profile: ' + getCurrentProfile());
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  console.log(chalk.bold('Active Profile: ' + profileName));
  info('Config directory: ' + getConfigDir());
  info('Environment: ' + getEnvironment());
  info('API Key: ' + (getApiKey() ? getApiKey()!.substring(0, 8) + '...' : chalk.gray('not set')));
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success('Configuration cleared for profile: ' + getCurrentProfile());
});

// ============================================
// Flight Search Commands
// ============================================
const flightsCmd = program.command('flights').description('Flight search and offers');

flightsCmd.command('search')
  .description('Search for flight offers')
  .requiredOption('--from <code>', 'Origin airport/city IATA code')
  .requiredOption('--to <code>', 'Destination airport/city IATA code')
  .requiredOption('--date <date>', 'Departure date (YYYY-MM-DD)')
  .option('--return <date>', 'Return date for round-trip (YYYY-MM-DD)')
  .option('--adults <number>', 'Number of adults', '1')
  .option('--children <number>', 'Number of children')
  .option('--infants <number>', 'Number of infants')
  .option('--class <class>', 'Travel class: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST')
  .option('--nonstop', 'Only non-stop flights')
  .option('--currency <code>', 'Currency code (e.g., EUR, USD)')
  .option('--max-price <amount>', 'Maximum price')
  .option('--max <number>', 'Maximum number of results', '10')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.flights.searchOffers({
        originLocationCode: opts.from.toUpperCase(),
        destinationLocationCode: opts.to.toUpperCase(),
        departureDate: opts.date,
        returnDate: opts.return,
        adults: parseInt(opts.adults),
        children: opts.children ? parseInt(opts.children) : undefined,
        infants: opts.infants ? parseInt(opts.infants) : undefined,
        travelClass: opts.class,
        nonStop: opts.nonstop,
        currencyCode: opts.currency,
        maxPrice: opts.maxPrice ? parseInt(opts.maxPrice) : undefined,
        max: parseInt(opts.max),
      });
      
      if (result.data.length === 0) {
        warn('No flights found');
        return;
      }

      info('Found ' + result.meta.count + ' flight offers');
      printFlightOffers(result.data, result.dictionaries?.carriers, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

flightsCmd.command('price <offerId>')
  .description('Get confirmed pricing for a flight offer')
  .action(async function(this: Command, offerId: string) {
    // This would require storing offers from search - simplified for now
    error('Price confirmation requires a full flight offer object. Use --format json with search to get offer data.');
    process.exit(1);
  });

// ============================================
// Airport/Location Commands
// ============================================
const locationsCmd = program.command('locations').description('Airport and city search');

locationsCmd.command('search <keyword>')
  .description('Search for airports and cities')
  .option('--type <type>', 'Type: AIRPORT or CITY')
  .action(async function(this: Command, keyword: string, opts) {
    try {
      const client = getClient();
      const result = await client.flights.searchLocations(keyword, opts.type);
      
      if (result.data.length === 0) {
        warn('No locations found');
        return;
      }

      printLocations(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

locationsCmd.command('get <iataCode>')
  .description('Get airport/city details by IATA code')
  .action(async function(this: Command, iataCode: string) {
    try {
      const client = getClient();
      const result = await client.flights.getLocation(iataCode.toUpperCase());
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Inspiration/Explore Commands
// ============================================
const exploreCmd = program.command('explore').description('Find flight deals and inspiration');

exploreCmd.command('destinations')
  .description('Find cheapest destinations from origin')
  .requiredOption('--from <code>', 'Origin airport IATA code')
  .option('--date <date>', 'Departure date (YYYY-MM-DD)')
  .option('--oneway', 'One-way flights only')
  .option('--nonstop', 'Non-stop flights only')
  .option('--max-price <amount>', 'Maximum price')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.flights.inspirationSearch(opts.from.toUpperCase(), {
        departureDate: opts.date,
        oneWay: opts.oneway,
        nonStop: opts.nonstop,
        maxPrice: opts.maxPrice ? parseInt(opts.maxPrice) : undefined,
      });
      
      if (result.data.length === 0) {
        warn('No destinations found');
        return;
      }

      printDestinations(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exploreCmd.command('dates')
  .description('Find cheapest dates for a route')
  .requiredOption('--from <code>', 'Origin airport IATA code')
  .requiredOption('--to <code>', 'Destination airport IATA code')
  .option('--date <date>', 'Approximate departure date (YYYY-MM-DD)')
  .option('--oneway', 'One-way flights only')
  .option('--nonstop', 'Non-stop flights only')
  .option('--max-price <amount>', 'Maximum price')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.flights.cheapestDates(
        opts.from.toUpperCase(),
        opts.to.toUpperCase(),
        {
          departureDate: opts.date,
          oneWay: opts.oneway,
          nonStop: opts.nonstop,
          maxPrice: opts.maxPrice ? parseInt(opts.maxPrice) : undefined,
        }
      );
      
      if (result.data.length === 0) {
        warn('No dates found');
        return;
      }

      printDestinations(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Airlines Commands
// ============================================
const airlinesCmd = program.command('airlines').description('Airline information');

airlinesCmd.command('get <code>')
  .description('Get airline by IATA code')
  .action(async function(this: Command, code: string) {
    try {
      const client = getClient();
      const result = await client.flights.getAirline(code.toUpperCase());
      
      if (result.data.length === 0) {
        warn('Airline not found');
        return;
      }

      print(result.data[0], getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

airlinesCmd.command('search <keyword>')
  .description('Search airlines by name')
  .action(async function(this: Command, keyword: string) {
    try {
      const client = getClient();
      const result = await client.flights.searchAirlines(keyword);
      
      if (result.data.length === 0) {
        warn('No airlines found');
        return;
      }

      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
