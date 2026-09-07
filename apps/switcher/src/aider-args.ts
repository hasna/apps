// Aider 0.86.2 uses argparse long-option abbreviation. Resolve its supported
// grammar before inspecting authority options; prompt values and -- are text.
const reserved = `model weak-model editor-model openai-api-key anthropic-api-key openai-api-base openai-api-type openai-api-version openai-api-deployment-id openai-organization-id set-env api-key model-settings-file model-metadata-file alias config env-file load input-history-file chat-history-file llm-history-file encoding gui browser opus sonnet haiku 4 4o mini 4-turbo 35turbo 35-turbo 3 deepseek o1-mini o1-preview`.split(" ");
const required = `list-models models reasoning-effort thinking-tokens timeout edit-format chat-mode editor-edit-format max-chat-history-tokens cache-keepalive-pings map-tokens map-refresh map-multiplier-no-files user-input-color tool-output-color tool-error-color tool-warning-color assistant-output-color completion-menu-color completion-menu-bg-color completion-menu-current-color completion-menu-current-bg-color code-theme aiderignore commit-prompt lint-cmd test-cmd analytics-log analytics-posthog-host analytics-posthog-project-api-key message message-file apply voice-format voice-language voice-input-device file read chat-language commit-language line-endings notifications-command editor shell-completions`.split(" ");
const toggles = `verify-ssl auto-accept-architect show-model-warnings check-model-accepts-settings cache-prompts restore-chat-history pretty stream git gitignore add-gitignore-files auto-commits dirty-commits attribute-author attribute-committer attribute-commit-message-author attribute-commit-message-committer attribute-co-authored-by git-commit-verify dry-run watch-files auto-lint auto-test analytics check-update show-release-notes gui browser copy-paste suggest-shell-commands fancy-input multiline notifications detect-urls`.split(" ");
const booleans = [...`help architect dark-mode light-mode show-diffs subtree-only commit skip-sanity-check-repo lint test analytics-disable just-check-update install-main-branch upgrade version apply-clipboard-edits exit show-repo-map show-prompts disable-playwright vim yes-always verbose`.split(" "), ...toggles, ...toggles.map(k=>`no-${k}`)];
const all = [...reserved,...required,...booleans];
export const aiderConfigKey=(key:string)=>all.includes(key)&&!key.startsWith("no-");
export function aiderArguments(args: readonly string[]): {args:string[];files:string[];reads:string[];restore:boolean} {
  const result:string[]=[];const files:string[]=[];const reads:string[]=[];let restore=false;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==="--") {result.push(...args.slice(i));files.push(...args.slice(i+1));break;}
    if(!arg.startsWith("-")||arg==="-") {result.push(arg);files.push(arg);continue;}
    if(arg==="-h"||arg==="-v") {result.push(arg);continue;}
    if(!arg.startsWith("--")) throw new Error("Unsupported Aider short option; use the full native option name.");
    const equal=arg.indexOf("="),name=arg.slice(2,equal<0?undefined:equal);
    const matching=all.includes(name)?[name]:all.filter(k=>k.startsWith(name));
    if(matching.length!==1) throw new Error("Unknown or ambiguous Aider option; use its full native option name.");
    const flag=matching[0];
    if(reserved.includes(flag)) throw new Error("Provider/model configuration and history paths are reserved by the launch profile; update the profile instead.");
    if(flag==="restore-chat-history"||flag==="no-restore-chat-history") {
      if(equal>=0) throw new Error("Aider history restore is a boolean option.");
      restore=flag==="restore-chat-history";continue;
    }
    result.push(`--${flag}${equal<0?"":arg.slice(equal)}`);
    if(required.includes(flag)) {
      const value=equal<0?args[++i]:arg.slice(equal+1);
      if(value===undefined) throw new Error(`Aider --${flag} requires a value.`);
      if(equal<0)result.push(value);
      if(flag==="file") files.push(value);
      if(flag==="read") reads.push(value);
    }
  }
  return {args:result,files,reads,restore};
}
