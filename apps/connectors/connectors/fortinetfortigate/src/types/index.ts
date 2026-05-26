export interface FortiGateConfig { url: string; token: string; }

export interface FGFirewallPolicy { policyid: number; name: string; srcintf: { name: string }[]; dstintf: { name: string }[]; srcaddr: { name: string }[]; dstaddr: { name: string }[]; action: string; schedule: string; service: { name: string }[]; status: string; logtraffic: string; }
export interface FGAddress { name: string; type: string; subnet: string; fqdn: string; associated_interface: string; comment: string; }
export interface FGInterface { name: string; ip: string; type: string; status: string; mtu: number; speed: string; vdom: string; }
export interface FGSystemStatus { version: string; serial: string; hostname: string; model_name: string; }
export interface FGVdom { name: string; }

export class FortiGateApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FortiGateApiError'; this.statusCode = statusCode; }
}
