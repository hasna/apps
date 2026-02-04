import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Units } from '../types';

const CONFIG_DIR = join(homedir(), '.connect', 'connect-openweathermap');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  apiKey?: string;
  units?: Units;
  lang?: string;
  defaultCity?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getApiKey(): string | undefined {
  return process.env.OPENWEATHERMAP_API_KEY || process.env.OPENWEATHER_API_KEY || loadConfig().apiKey;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
}

export function getUnits(): Units {
  return (process.env.OPENWEATHERMAP_UNITS as Units) || loadConfig().units || 'metric';
}

export function setUnits(units: Units): void {
  const config = loadConfig();
  config.units = units;
  saveConfig(config);
}

export function getLang(): string {
  return process.env.OPENWEATHERMAP_LANG || loadConfig().lang || 'en';
}

export function setLang(lang: string): void {
  const config = loadConfig();
  config.lang = lang;
  saveConfig(config);
}

export function getDefaultCity(): string | undefined {
  return process.env.OPENWEATHERMAP_CITY || loadConfig().defaultCity;
}

export function setDefaultCity(city: string): void {
  const config = loadConfig();
  config.defaultCity = city;
  saveConfig(config);
}

export function clearConfig(): void {
  saveConfig({});
}
