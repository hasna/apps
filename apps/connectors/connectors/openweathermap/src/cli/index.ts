#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { OpenWeatherMap } from '../api';
import {
  getApiKey,
  setApiKey,
  getUnits,
  setUnits,
  getLang,
  setLang,
  getDefaultCity,
  setDefaultCity,
  clearConfig,
  loadConfig,
} from '../utils/config';
import type { OutputFormat, Units } from '../types';
import {
  success,
  error,
  warn,
  info,
  print,
  formatTemp,
  formatWind,
  formatTimestamp,
  formatTime,
  getWeatherEmoji,
  getAqiLabel,
} from '../utils/output';

const pkg = await import('../../package.json');
const VERSION = pkg.version || '0.0.0';

const program = new Command();

program
  .name('connect-openweathermap')
  .description('OpenWeatherMap API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'OpenWeatherMap API key')
  .option('-u, --units <units>', 'Units: metric, imperial, standard', 'metric')
  .option('-f, --format <format>', 'Output format: json, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.apiKey) {
      process.env.OPENWEATHERMAP_API_KEY = opts.apiKey;
    }
  });

function getClient(): OpenWeatherMap {
  const apiKey = getApiKey();
  if (!apiKey) {
    error('No API key configured. Run "connect-openweathermap config set-key <key>" or set OPENWEATHERMAP_API_KEY');
    process.exit(1);
  }
  const opts = program.opts();
  return new OpenWeatherMap({
    apiKey,
    units: (opts.units as Units) || getUnits(),
    lang: getLang(),
  });
}

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set OpenWeatherMap API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved');
  });

configCmd
  .command('set-units <units>')
  .description('Set default units (metric, imperial, standard)')
  .action((units: string) => {
    if (!['metric', 'imperial', 'standard'].includes(units)) {
      error('Invalid units. Use: metric, imperial, or standard');
      process.exit(1);
    }
    setUnits(units as Units);
    success(`Default units set to: ${units}`);
  });

configCmd
  .command('set-city <city>')
  .description('Set default city')
  .action((city: string) => {
    setDefaultCity(city);
    success(`Default city set to: ${city}`);
  });

configCmd
  .command('set-lang <lang>')
  .description('Set language code (e.g., en, es, fr, de)')
  .action((lang: string) => {
    setLang(lang);
    success(`Language set to: ${lang}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    const apiKey = getApiKey();
    console.log(chalk.bold('OpenWeatherMap Configuration:'));
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : chalk.gray('not set')}`);
    info(`Units: ${config.units || 'metric'}`);
    info(`Language: ${config.lang || 'en'}`);
    info(`Default City: ${config.defaultCity || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear all configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Current Weather Commands
// ============================================
const currentCmd = program
  .command('current')
  .description('Get current weather');

currentCmd
  .command('city [name]')
  .description('Get current weather by city name')
  .option('-c, --country <code>', 'Country code (e.g., US, GB)')
  .action(async (name: string | undefined, opts) => {
    try {
      const city = name || getDefaultCity();
      if (!city) {
        error('City name required. Provide it as argument or set default with "config set-city"');
        process.exit(1);
      }
      const client = getClient();
      const weather = await client.weather.getCurrentByCity(city, opts.country);
      const format = getFormat(currentCmd);

      if (format === 'json') {
        print(weather, format);
      } else {
        const tempUnit = client.getUnitSymbol('temp');
        const speedUnit = client.getUnitSymbol('speed');
        const emoji = getWeatherEmoji(weather.weather[0]?.icon || '01d');

        console.log();
        console.log(chalk.bold(`${emoji} Weather in ${weather.name}, ${weather.sys.country}`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.cyan('Condition:')}  ${weather.weather[0]?.description}`);
        console.log(`${chalk.cyan('Temperature:')} ${formatTemp(weather.main.temp, tempUnit)} (feels like ${formatTemp(weather.main.feels_like, tempUnit)})`);
        console.log(`${chalk.cyan('Min/Max:')}    ${formatTemp(weather.main.temp_min, tempUnit)} / ${formatTemp(weather.main.temp_max, tempUnit)}`);
        console.log(`${chalk.cyan('Humidity:')}   ${weather.main.humidity}%`);
        console.log(`${chalk.cyan('Pressure:')}   ${weather.main.pressure} hPa`);
        console.log(`${chalk.cyan('Wind:')}       ${formatWind(weather.wind.speed, speedUnit, weather.wind.deg)}`);
        console.log(`${chalk.cyan('Visibility:')} ${(weather.visibility / 1000).toFixed(1)} km`);
        console.log(`${chalk.cyan('Clouds:')}     ${weather.clouds.all}%`);
        console.log(`${chalk.cyan('Sunrise:')}    ${formatTime(weather.sys.sunrise, weather.timezone)}`);
        console.log(`${chalk.cyan('Sunset:')}     ${formatTime(weather.sys.sunset, weather.timezone)}`);
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

currentCmd
  .command('coords <lat> <lon>')
  .description('Get current weather by coordinates')
  .action(async (lat: string, lon: string) => {
    try {
      const client = getClient();
      const weather = await client.weather.getCurrentByCoords(parseFloat(lat), parseFloat(lon));
      const format = getFormat(currentCmd);

      if (format === 'json') {
        print(weather, format);
      } else {
        const tempUnit = client.getUnitSymbol('temp');
        const speedUnit = client.getUnitSymbol('speed');
        const emoji = getWeatherEmoji(weather.weather[0]?.icon || '01d');

        console.log();
        console.log(chalk.bold(`${emoji} Weather at ${lat}, ${lon} (${weather.name || 'Unknown'})`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.cyan('Condition:')}  ${weather.weather[0]?.description}`);
        console.log(`${chalk.cyan('Temperature:')} ${formatTemp(weather.main.temp, tempUnit)} (feels like ${formatTemp(weather.main.feels_like, tempUnit)})`);
        console.log(`${chalk.cyan('Humidity:')}   ${weather.main.humidity}%`);
        console.log(`${chalk.cyan('Wind:')}       ${formatWind(weather.wind.speed, speedUnit, weather.wind.deg)}`);
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

currentCmd
  .command('zip <zipCode>')
  .description('Get current weather by ZIP code')
  .option('-c, --country <code>', 'Country code (default: US)')
  .action(async (zipCode: string, opts) => {
    try {
      const client = getClient();
      const weather = await client.weather.getCurrentByZip(zipCode, opts.country || 'US');
      const format = getFormat(currentCmd);

      if (format === 'json') {
        print(weather, format);
      } else {
        const tempUnit = client.getUnitSymbol('temp');
        const emoji = getWeatherEmoji(weather.weather[0]?.icon || '01d');

        console.log();
        console.log(chalk.bold(`${emoji} Weather in ${weather.name}`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.cyan('Condition:')}  ${weather.weather[0]?.description}`);
        console.log(`${chalk.cyan('Temperature:')} ${formatTemp(weather.main.temp, tempUnit)}`);
        console.log(`${chalk.cyan('Humidity:')}   ${weather.main.humidity}%`);
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Forecast Commands
// ============================================
const forecastCmd = program
  .command('forecast')
  .description('Get weather forecast');

forecastCmd
  .command('city [name]')
  .description('Get 5-day forecast by city name')
  .option('-c, --country <code>', 'Country code')
  .option('-n, --count <number>', 'Number of 3-hour periods to return')
  .action(async (name: string | undefined, opts) => {
    try {
      const city = name || getDefaultCity();
      if (!city) {
        error('City name required');
        process.exit(1);
      }
      const client = getClient();
      const forecast = await client.weather.getForecastByCity(city, opts.country, opts.count ? parseInt(opts.count) : undefined);
      const format = getFormat(forecastCmd);

      if (format === 'json') {
        print(forecast, format);
      } else {
        const tempUnit = client.getUnitSymbol('temp');

        console.log();
        console.log(chalk.bold(`📅 5-Day Forecast for ${forecast.city.name}, ${forecast.city.country}`));
        console.log(chalk.gray('─'.repeat(60)));

        // Group by day
        const byDay = new Map<string, typeof forecast.list>();
        for (const item of forecast.list) {
          const date = item.dt_txt.split(' ')[0];
          if (!byDay.has(date)) {
            byDay.set(date, []);
          }
          byDay.get(date)!.push(item);
        }

        for (const [date, items] of byDay) {
          const dayDate = new Date(date);
          const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

          const temps = items.map(i => i.main.temp);
          const minTemp = Math.min(...temps);
          const maxTemp = Math.max(...temps);
          const mainCondition = items[Math.floor(items.length / 2)].weather[0];
          const emoji = getWeatherEmoji(mainCondition?.icon || '01d');

          console.log();
          console.log(`${emoji} ${chalk.bold(dayName)}`);
          console.log(`   ${chalk.cyan('High/Low:')} ${formatTemp(maxTemp, tempUnit)} / ${formatTemp(minTemp, tempUnit)}`);
          console.log(`   ${chalk.cyan('Condition:')} ${mainCondition?.description}`);

          // Show hourly breakdown
          const hourly = items.slice(0, 4).map(i => {
            const time = i.dt_txt.split(' ')[1].substring(0, 5);
            return `${time}: ${formatTemp(i.main.temp, tempUnit)}`;
          }).join(' | ');
          console.log(`   ${chalk.gray(hourly)}`);
        }
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

forecastCmd
  .command('coords <lat> <lon>')
  .description('Get 5-day forecast by coordinates')
  .action(async (lat: string, lon: string) => {
    try {
      const client = getClient();
      const forecast = await client.weather.getForecastByCoords(parseFloat(lat), parseFloat(lon));
      print(forecast, getFormat(forecastCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Air Quality Commands
// ============================================
const airCmd = program
  .command('air')
  .description('Get air quality data');

airCmd
  .command('coords <lat> <lon>')
  .description('Get air quality by coordinates')
  .action(async (lat: string, lon: string) => {
    try {
      const client = getClient();
      const data = await client.weather.getAirPollution(parseFloat(lat), parseFloat(lon));
      const format = getFormat(airCmd);

      if (format === 'json') {
        print(data, format);
      } else {
        const pollution = data.list[0];
        const { label, color } = getAqiLabel(pollution.main.aqi);

        console.log();
        console.log(chalk.bold(`🌬️ Air Quality at ${lat}, ${lon}`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.cyan('AQI:')}  ${color(label)} (${pollution.main.aqi}/5)`);
        console.log();
        console.log(chalk.bold('Components (μg/m³):'));
        console.log(`  CO:    ${pollution.components.co.toFixed(1)}`);
        console.log(`  NO:    ${pollution.components.no.toFixed(1)}`);
        console.log(`  NO₂:   ${pollution.components.no2.toFixed(1)}`);
        console.log(`  O₃:    ${pollution.components.o3.toFixed(1)}`);
        console.log(`  SO₂:   ${pollution.components.so2.toFixed(1)}`);
        console.log(`  PM2.5: ${pollution.components.pm2_5.toFixed(1)}`);
        console.log(`  PM10:  ${pollution.components.pm10.toFixed(1)}`);
        console.log(`  NH₃:   ${pollution.components.nh3.toFixed(1)}`);
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

airCmd
  .command('city <name>')
  .description('Get air quality by city name (geocodes first)')
  .option('-c, --country <code>', 'Country code')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      // First geocode the city
      const locations = await client.weather.geocode(name, opts.country, 1);
      if (locations.length === 0) {
        error(`City "${name}" not found`);
        process.exit(1);
      }
      const { lat, lon } = locations[0];
      info(`Found: ${locations[0].name}, ${locations[0].country} (${lat}, ${lon})`);

      const data = await client.weather.getAirPollution(lat, lon);
      const format = getFormat(airCmd);

      if (format === 'json') {
        print(data, format);
      } else {
        const pollution = data.list[0];
        const { label, color } = getAqiLabel(pollution.main.aqi);

        console.log();
        console.log(chalk.bold(`🌬️ Air Quality in ${locations[0].name}`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`${chalk.cyan('AQI:')}  ${color(label)} (${pollution.main.aqi}/5)`);
        console.log(`${chalk.cyan('PM2.5:')} ${pollution.components.pm2_5.toFixed(1)} μg/m³`);
        console.log(`${chalk.cyan('PM10:')}  ${pollution.components.pm10.toFixed(1)} μg/m³`);
        console.log(`${chalk.cyan('O₃:')}    ${pollution.components.o3.toFixed(1)} μg/m³`);
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Geocoding Commands
// ============================================
const geoCmd = program
  .command('geo')
  .description('Geocoding utilities');

geoCmd
  .command('search <city>')
  .description('Search for a city and get coordinates')
  .option('-c, --country <code>', 'Country code')
  .option('-l, --limit <number>', 'Max results', '5')
  .action(async (city: string, opts) => {
    try {
      const client = getClient();
      const locations = await client.weather.geocode(city, opts.country, parseInt(opts.limit));

      if (locations.length === 0) {
        warn('No locations found');
        return;
      }

      success(`Found ${locations.length} location(s):`);
      locations.forEach((loc, i) => {
        console.log(`  ${i + 1}. ${loc.name}${loc.state ? `, ${loc.state}` : ''}, ${loc.country}`);
        console.log(`     Coordinates: ${loc.lat}, ${loc.lon}`);
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

geoCmd
  .command('reverse <lat> <lon>')
  .description('Get location name from coordinates')
  .action(async (lat: string, lon: string) => {
    try {
      const client = getClient();
      const locations = await client.weather.reverseGeocode(parseFloat(lat), parseFloat(lon));

      if (locations.length === 0) {
        warn('No locations found');
        return;
      }

      const loc = locations[0];
      success(`${loc.name}${loc.state ? `, ${loc.state}` : ''}, ${loc.country}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
