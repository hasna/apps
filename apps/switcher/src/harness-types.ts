import type { Model, Provider, Profile } from "./domain";
export type HarnessId = Profile["harness"];
export type HarnessLaunchInput = {
  harness: HarnessId; baseUrl: string; protocol: Provider["protocol"]; authStyle?: Provider["authStyle"];
  model: string; models: Model[]; credential?: string; executable?: string; args?: string[];
  stateDir: string; cwd: string; version?: string; sessionDir?: string;
};
export type PreparedLaunch = {executable:string;args:string[];env:Record<string,string>;configPaths:string[];warnings:string[];cleanup?:()=>Promise<void>};
