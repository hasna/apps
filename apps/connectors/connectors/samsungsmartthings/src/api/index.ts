// Samsung SmartThings Connector — IoT platform for smart home control
import { SmartThingsClient } from './client';
import type { SmartThingsConfig, STDevice, STDeviceList, STDeviceStatus, STLocation, STRoom, STScene } from '../types';
export { SmartThingsClient } from './client';

export class SmartThings {
  private readonly client: SmartThingsClient;
  constructor(config: SmartThingsConfig) { this.client = new SmartThingsClient(config); }
  static fromEnv(): SmartThings {
    const token = process.env.SMARTTHINGS_TOKEN;
    if (!token) throw new Error('SMARTTHINGS_TOKEN is required');
    return new SmartThings({ token });
  }

  async listDevices(options?: { locationId?: string; capability?: string }): Promise<STDeviceList> {
    return this.client.request<STDeviceList>('/devices', { params: { locationId: options?.locationId, capability: options?.capability } });
  }
  async getDevice(deviceId: string): Promise<STDevice> { return this.client.request<STDevice>(`/devices/${deviceId}`); }
  async getDeviceStatus(deviceId: string): Promise<STDeviceStatus> { return this.client.request<STDeviceStatus>(`/devices/${deviceId}/status`); }
  async executeCommand(deviceId: string, commands: { component: string; capability: string; command: string; arguments?: unknown[] }[]): Promise<void> {
    await this.client.request(`/devices/${deviceId}/commands`, { method: 'POST', body: { commands } as Record<string, unknown> });
  }

  async listLocations(): Promise<{ items: STLocation[] }> { return this.client.request('/locations'); }
  async getLocation(locationId: string): Promise<STLocation> { return this.client.request<STLocation>(`/locations/${locationId}`); }

  async listRooms(locationId: string): Promise<{ items: STRoom[] }> { return this.client.request(`/locations/${locationId}/rooms`); }

  async listScenes(): Promise<{ items: STScene[] }> { return this.client.request('/scenes'); }
  async executeScene(sceneId: string): Promise<void> { await this.client.request(`/scenes/${sceneId}/execute`, { method: 'POST' }); }

  getClient(): SmartThingsClient { return this.client; }
}
