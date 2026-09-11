import type { Model, Provider, Profile } from "./domain";
import type { CompiledModelPolicy, ModelPolicy } from "./model-policy";
import type { NativeModelPolicy } from "./native-model-policy";
import type { RoutingEvent } from "./inference-gateway";
import type { ReasoningEffort } from "./reasoning";
export type HarnessId = Profile["harness"];
export type HarnessLaunchInput = {
  harness: HarnessId; baseUrl: string; protocol: Provider["protocol"]; authStyle?: Provider["authStyle"];
  model: string; models: Model[]; credential?: string; executable?: string; args?: string[];
  stateDir: string; cwd: string; version?: string; sessionDir?: string;
  providerId?: string; providerBaseUrl?: string; modelPolicy?: ModelPolicy; compiledPolicy?: CompiledModelPolicy;
  nativePolicy?: NativeModelPolicy; onRoutingEvent?: (event: RoutingEvent) => void;
  reasoning?:ReasoningEffort; dangerouslyBypassApprovalsAndSandbox?:boolean;
};
export type PreparedLaunch = {executable:string;args:string[];env:Record<string,string>;configPaths:string[];warnings:string[];beforeLaunch?:()=>Promise<void>;cleanup?:()=>Promise<void>};
