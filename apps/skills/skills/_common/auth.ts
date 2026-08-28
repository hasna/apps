/**
 * Skill Authentication Check
 * Add this to the top of any skill's main function
 */

export function checkSkillAuth(): void {
  const skillsApiKey = process.env.SKILLS_API_KEY || process.env.SKILL_API_KEY;

  if (!skillsApiKey) {
    console.error('Error: SKILLS_API_KEY environment variable not set');
    console.error('');
    console.error('To use hosted execution, set your SKILLS_API_KEY:');
    console.error('');
    console.error('  Set the SKILLS_API_KEY environment variable to your API key');
    console.error('');
    console.error('You can also use the root `skills auth login` command.');
    process.exit(1);
  }

  if (!skillsApiKey.startsWith('sk-skill-')) {
    console.error('Error: Invalid SKILLS_API_KEY format');
    console.error('Expected format: the "sk-skill-" prefix followed by the token');
    process.exit(1);
  }
}

/**
 * Check if running remotely (via SSH or network)
 */
export function isRemoteExecution(): boolean {
  return !!(
    process.env.SSH_CONNECTION ||
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY
  );
}

/**
 * Require auth only if remote execution
 */
export function requireAuthIfRemote(): void {
  if (isRemoteExecution()) {
    checkSkillAuth();
  }
}
