export interface SmartThingsConfig { token: string; }

export interface STDevice { deviceId: string; name: string; label: string; deviceManufacturerCode: string; locationId: string; roomId: string; deviceTypeId: string; components: { id: string; capabilities: { id: string; version: number }[] }[]; }
export interface STDeviceList { items: STDevice[]; }
export interface STDeviceStatus { components: Record<string, Record<string, { value: unknown; unit?: string; timestamp: string }>>; }
export interface STLocation { locationId: string; name: string; countryCode: string; latitude: number; longitude: number; temperatureScale: string; timeZoneId: string; }
export interface STRoom { roomId: string; locationId: string; name: string; }
export interface STScene { sceneId: string; sceneName: string; locationId: string; }
export interface STSubscription { id: string; installedAppId: string; sourceType: string; device?: { deviceId: string; componentId: string; capability: string; attribute: string }; }

export class SmartThingsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SmartThingsApiError'; this.statusCode = statusCode; }
}
