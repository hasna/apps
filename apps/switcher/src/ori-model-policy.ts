import {isAbsolute} from "node:path";
import type {PreparedLaunch} from "./harness-types";

/** Execute the verified native launch after Ori finishes its OpenRouter setup.
 * Credentials are remapped from process environment, never written into the shim. */
export function prepareOriModelPolicy(target:"codex"|"grok", prepared:Pick<PreparedLaunch,"executable"|"args"|"env">) {
  if(!isAbsolute(prepared.executable)||/[\0\r\n]/.test(prepared.executable))throw new Error("Ori requires an absolute verified native executable.");
  const entries=Object.entries(prepared.env);
  if(entries.some(([key])=>! /^[A-Z_][A-Z0-9_]*$/.test(key)))throw new Error("Invalid native environment key.");
  if(entries.some(([,value])=>value.includes("\0")))throw new Error("Invalid native environment value.");
  if(prepared.args.some(arg=>arg.includes("\0")))throw new Error("Invalid native argument.");
  const quote=(value:string)=>`'${value.replaceAll("'","'\"'\"'")}'`;
  const env:Record<string,string>={SWITCHER_ORI_NATIVE_EXECUTABLE:prepared.executable};
  for(const [key,value] of entries)env[`SWITCHER_ORI_CHILD_${key}`]=value;
  const restore=entries.map(([key])=>`export ${key}="$SWITCHER_ORI_CHILD_${key}"`).join("\n");
  return {name:target,env,script:`#!/bin/sh\nset -eu\nunset OPENROUTER_API_KEY OPENAI_API_KEY XAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN GROK_MODELS_BASE_URL GROK_MODELS_LIST_URL GROK_XAI_API_BASE_URL\n${restore}\nexec "$SWITCHER_ORI_NATIVE_EXECUTABLE" ${prepared.args.map(quote).join(" ")}\n`};
}
