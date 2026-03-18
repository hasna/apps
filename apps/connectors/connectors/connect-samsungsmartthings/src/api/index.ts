// Samsung SmartThings Connector
// IoT device control, locations, rooms, and scene automation

import { SmartThingsClient } from './client';
import type {
  SmartThingsConfig, Device, DeviceStatus, DeviceCommand, Location, Room, Scene,
} from '../types';

export { SmartThingsClient } from './client';

export class SmartThings {
  private readonly client: SmartThingsClient;

  constructor(config: SmartThingsConfig) {
    this.client = new SmartThingsClient(config);
  }

  static fromEnv(): SmartThings {
    const token = process.env.SMARTTHINGS_TOKEN || process.env.SMARTTHINGS_PAT;
    if (!token) throw new Error('SMARTTHINGS_TOKEN environment variable is required');
    return new SmartThings({ token });
  }

  // Devices
  async listDevices(options?: { locationId?: string; capability?: string; deviceId?: string[] }): Promise<Device[]> {
    const result = await this.client.request<{ items: Device[] }>('/devices', {
      params: {
        locationId: options?.locationId,
        capability: options?.capability,
      },
    });
    return result.items;
  }

  async getDevice(deviceId: string): Promise<Device> {
    return this.client.request<Device>(`/devices/${deviceId}`);
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    return this.client.request<DeviceStatus>(`/devices/${deviceId}/status`);
  }

  async getComponentStatus(deviceId: string, componentId: string): Promise<Record<string, Record<string, { value: unknown }>>> {
    return this.client.request(`/devices/${deviceId}/components/${componentId}/status`);
  }

  async sendCommand(deviceId: string, commands: DeviceCommand[]): Promise<{ results: Array<{ id: string; status: string }> }> {
    return this.client.request(`/devices/${deviceId}/commands`, {
      method: 'POST',
      body: { commands },
    });
  }

  /** Convenience: turn a device on/off */
  async setSwitch(deviceId: string, state: 'on' | 'off'): Promise<void> {
    await this.sendCommand(deviceId, [{ component: 'main', capability: 'switch', command: state }]);
  }

  /** Set a dimmer/light level (0-100) */
  async setSwitchLevel(deviceId: string, level: number): Promise<void> {
    await this.sendCommand(deviceId, [{ component: 'main', capability: 'switchLevel', command: 'setLevel', arguments: [Math.min(100, Math.max(0, level))] }]);
  }

  /** Set thermostat heating/cooling setpoint */
  async setThermostat(deviceId: string, mode: 'heat' | 'cool' | 'auto' | 'off'): Promise<void> {
    await this.sendCommand(deviceId, [{ component: 'main', capability: 'thermostatMode', command: 'setThermostatMode', arguments: [mode] }]);
  }

  // Locations
  async listLocations(): Promise<Location[]> {
    const result = await this.client.request<{ items: Location[] }>('/locations');
    return result.items;
  }

  async getLocation(locationId: string): Promise<Location> {
    return this.client.request<Location>(`/locations/${locationId}`);
  }

  // Rooms
  async listRooms(locationId: string): Promise<Room[]> {
    const result = await this.client.request<{ items: Room[] }>(`/locations/${locationId}/rooms`);
    return result.items;
  }

  // Scenes
  async listScenes(locationId?: string): Promise<Scene[]> {
    const result = await this.client.request<{ items: Scene[] }>('/scenes', {
      params: { locationId },
    });
    return result.items;
  }

  async executeScene(sceneId: string): Promise<void> {
    await this.client.request(`/scenes/${sceneId}/execute`, { method: 'POST' });
  }

  getClient(): SmartThingsClient { return this.client; }
}
