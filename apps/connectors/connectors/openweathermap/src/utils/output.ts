import chalk from 'chalk';
import type { OutputFormat } from '../types';

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === 'table' && Array.isArray(data)) {
    console.table(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Weather-specific formatting helpers
export function formatTemp(temp: number, unit: string): string {
  return `${Math.round(temp)}${unit}`;
}

export function formatWind(speed: number, unit: string, deg?: number): string {
  const direction = deg !== undefined ? ` ${getWindDirection(deg)}` : '';
  return `${speed.toFixed(1)} ${unit}${direction}`;
}

export function getWindDirection(deg: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
}

export function formatTimestamp(timestamp: number, timezone?: number): string {
  const date = new Date((timestamp + (timezone || 0)) * 1000);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function formatTime(timestamp: number, timezone?: number): string {
  const date = new Date((timestamp + (timezone || 0)) * 1000);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function getWeatherEmoji(iconCode: string): string {
  const emojiMap: Record<string, string> = {
    '01d': '☀️',  // clear sky day
    '01n': '🌙',  // clear sky night
    '02d': '⛅',  // few clouds day
    '02n': '☁️',  // few clouds night
    '03d': '☁️',  // scattered clouds
    '03n': '☁️',
    '04d': '☁️',  // broken clouds
    '04n': '☁️',
    '09d': '🌧️',  // shower rain
    '09n': '🌧️',
    '10d': '🌦️',  // rain day
    '10n': '🌧️',  // rain night
    '11d': '⛈️',  // thunderstorm
    '11n': '⛈️',
    '13d': '❄️',  // snow
    '13n': '❄️',
    '50d': '🌫️',  // mist
    '50n': '🌫️',
  };
  return emojiMap[iconCode] || '🌡️';
}

export function getAqiLabel(aqi: number): { label: string; color: typeof chalk } {
  switch (aqi) {
    case 1:
      return { label: 'Good', color: chalk.green };
    case 2:
      return { label: 'Fair', color: chalk.yellow };
    case 3:
      return { label: 'Moderate', color: chalk.hex('#FFA500') };
    case 4:
      return { label: 'Poor', color: chalk.red };
    case 5:
      return { label: 'Very Poor', color: chalk.bgRed.white };
    default:
      return { label: 'Unknown', color: chalk.gray };
  }
}
