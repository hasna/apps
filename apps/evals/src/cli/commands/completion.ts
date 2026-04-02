import { Command } from "commander";

const BASH_COMPLETION = `
# evals bash completion
_evals_completions() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local commands="run ci judge compare estimate generate calibrate capture doctor mcp completion sync --version --help"

  case "\${prev}" in
    evals)
      COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
    run|ci|estimate|generate|calibrate|capture)
      COMPREPLY=( \$(compgen -f -X "!*.jsonl" -- "\${cur}") \$(compgen -f -X "!*.json" -- "\${cur}") )
      return 0
      ;;
    --adapter)
      COMPREPLY=( \$(compgen -W "http anthropic openai mcp function cli" -- "\${cur}") )
      return 0
      ;;
    --output)
      COMPREPLY=( \$(compgen -W "terminal json markdown" -- "\${cur}") )
      return 0
      ;;
    --model)
      COMPREPLY=( \$(compgen -W "claude-sonnet-4-6 claude-opus-4-6 claude-haiku-4-5 gpt-4o gpt-4o-mini" -- "\${cur}") )
      return 0
      ;;
  esac

  COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
}
complete -F _evals_completions evals
`;

const ZSH_COMPLETION = `
#compdef evals

_evals() {
  local -a commands
  commands=(
    'run:Run an eval dataset against your app'
    'ci:CI mode — exit non-zero on regression'
    'judge:One-shot LLM judge for a single response'
    'compare:Compare two eval runs'
    'estimate:Estimate cost before running'
    'generate:Generate eval cases with Claude'
    'calibrate:Calibrate judge against gold labels'
    'capture:Capture production traffic as eval cases'
    'doctor:Health check'
    'mcp:MCP server management'
    'completion:Print shell completion script'
    'sync:Sync eval runs and datasets with cloud'
  )

  _arguments -C \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '1: :->command' \\
    '*: :->args'

  case \$state in
    command) _describe 'evals commands' commands ;;
    args)
      case \$words[2] in
        run|estimate|generate|calibrate)
          _files -g "*.jsonl" -g "*.json"
          ;;
      esac
      ;;
  esac
}

_evals
`;

export function completionCommand(): Command {
  return new Command("completion")
    .description("Print shell completion script")
    .argument("<shell>", "Shell type: bash or zsh")
    .action((shell: string) => {
      if (shell === "bash") {
        console.log(BASH_COMPLETION.trim());
        console.log('\n# Add to ~/.bashrc:\n# eval "$(evals completion bash)"');
      } else if (shell === "zsh") {
        console.log(ZSH_COMPLETION.trim());
        console.log('\n# Add to ~/.zshrc:\n# eval "$(evals completion zsh)"');
      } else {
        console.error(`Unknown shell: ${shell}. Use: bash or zsh`);
        process.exit(1);
      }
    });
}
