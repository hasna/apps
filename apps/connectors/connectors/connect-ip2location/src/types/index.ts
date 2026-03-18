export interface IP2LocationConfig { apiKey: string; }

export interface IP2LocationResult { ip: string; country_code: string; country_name: string; region_name: string; city_name: string; latitude: number; longitude: number; zip_code: string; time_zone: string; asn: string; as: string; isp: string; domain: string; net_speed: string; idd_code: string; area_code: string; weather_station_code: string; weather_station_name: string; mcc: string; mnc: string; mobile_brand: string; elevation: number; usage_type: string; address_type: string; district: string; is_proxy: boolean; }
export interface IP2ProxyResult { ip: string; is_proxy: boolean; proxy_type: string; country_code: string; country_name: string; region_name: string; city_name: string; isp: string; domain: string; usage_type: string; asn: string; as: string; threat: string; provider: string; }

export class IP2LocationApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'IP2LocationApiError'; this.statusCode = statusCode; }
}
