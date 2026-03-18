export interface SmartThingsConfig {
  token: string;
  baseUrl?: string;
}

export interface Device {
  deviceId: string;
  name: string;
  label: string | null;
  manufacturerName: string | null;
  presentationId: string | null;
  deviceTypeName: string | null;
  deviceNetworkType: string | null;
  locationId: string | null;
  roomId: string | null;
  components: Array<{
    id: string;
    label: string;
    capabilities: Array<{ id: string; version: number }>;
  }>;
}

export interface DeviceStatus {
  components: Record<string, Record<string, Record<string, { value: unknown; timestamp?: string }>>>;
}

export interface DeviceCommand {
  component: string;
  capability: string;
  command: string;
  arguments?: unknown[];
}

export interface Location {
  locationId: string;
  name: string;
  countryCode: string;
  locale: string;
  latitude?: number;
  longitude?: number;
  temperatureScale?: 'C' | 'F';
  timeZoneId?: string;
}

export interface Room {
  roomId: string;
  locationId: string;
  name: string;
  backgroundImage: string | null;
}

export interface Scene {
  sceneId: string;
  sceneName: string;
  locationId: string;
  createdBy: string | null;
}

export class SmartThingsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SmartThingsApiError';
    this.statusCode = statusCode;
  }
}
