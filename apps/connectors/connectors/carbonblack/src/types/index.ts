export interface CarbonBlackConfig { url: string; orgKey: string; apiId: string; apiSecretKey: string; }

export interface CBDevice { id: number; name: string; status: string; os: string; os_version: string; policy_name: string; last_contact_time: string; last_internal_ip_address: string; last_external_ip_address: string; sensor_version: string; quarantined: boolean; }
export interface CBDeviceList { results: CBDevice[]; num_found: number; }
export interface CBAlert { id: string; type: string; severity: number; device_name: string; device_id: number; reason: string; threat_id: string; workflow: { state: string }; create_time: string; last_update_time: string; }
export interface CBAlertList { results: CBAlert[]; num_found: number; }
export interface CBProcess { process_guid: string; process_name: string; process_pid: number[]; device_name: string; device_id: number; parent_name: string; process_username: string[]; process_start_time: string; }
export interface CBEvent { event_timestamp: string; event_type: string; process_guid: string; process_name: string; }

export class CarbonBlackApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CarbonBlackApiError'; this.statusCode = statusCode; }
}
