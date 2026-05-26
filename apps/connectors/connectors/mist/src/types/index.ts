export interface MistConfig { token: string; baseUrl?: string; }

export interface MistSite { id: string; name: string; address: string; timezone: string; country_code: string; lat: number; lng: number; }
export interface MistAP { id: string; name: string; mac: string; model: string; serial: string; site_id: string; status: string; ip: string; last_seen: number; }
export interface MistClient { mac: string; hostname: string; ip: string; ssid: string; band: string; ap_mac: string; rssi: number; rx_bytes: number; tx_bytes: number; }
export interface MistWlan { id: string; ssid: string; enabled: boolean; auth: { type: string }; band: string; vlan_id: number; }
export interface MistOrg { id: string; name: string; }

export class MistApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MistApiError'; this.statusCode = statusCode; }
}
