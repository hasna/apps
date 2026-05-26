import type { DiscordClient } from './client';
import type {
  ApplicationCommand,
  Snowflake,
  CreateApplicationCommandOptions,
} from '../types';

export class CommandsApi {
  constructor(private readonly client: DiscordClient) {}

  private getAppId(): string {
    const appId = this.client.getApplicationId();
    if (!appId) {
      throw new Error('Application ID is required for commands API');
    }
    return appId;
  }

  // ==================== Global Commands ====================

  /**
   * Get global application commands
   */
  async getGlobalCommands(withLocalizations?: boolean): Promise<ApplicationCommand[]> {
    const appId = this.getAppId();
    return this.client.get<ApplicationCommand[]>(
      `/applications/${appId}/commands`,
      { with_localizations: withLocalizations }
    );
  }

  /**
   * Create a global application command
   */
  async createGlobalCommand(
    options: CreateApplicationCommandOptions
  ): Promise<ApplicationCommand> {
    const appId = this.getAppId();
    return this.client.post<ApplicationCommand>(
      `/applications/${appId}/commands`,
      options
    );
  }

  /**
   * Get a global application command
   */
  async getGlobalCommand(commandId: Snowflake): Promise<ApplicationCommand> {
    const appId = this.getAppId();
    return this.client.get<ApplicationCommand>(
      `/applications/${appId}/commands/${commandId}`
    );
  }

  /**
   * Edit a global application command
   */
  async editGlobalCommand(
    commandId: Snowflake,
    options: Partial<CreateApplicationCommandOptions>
  ): Promise<ApplicationCommand> {
    const appId = this.getAppId();
    return this.client.patch<ApplicationCommand>(
      `/applications/${appId}/commands/${commandId}`,
      options
    );
  }

  /**
   * Delete a global application command
   */
  async deleteGlobalCommand(commandId: Snowflake): Promise<void> {
    const appId = this.getAppId();
    return this.client.delete(`/applications/${appId}/commands/${commandId}`);
  }

  /**
   * Bulk overwrite global application commands
   */
  async bulkOverwriteGlobalCommands(
    commands: CreateApplicationCommandOptions[]
  ): Promise<ApplicationCommand[]> {
    const appId = this.getAppId();
    return this.client.put<ApplicationCommand[]>(
      `/applications/${appId}/commands`,
      commands as unknown as Record<string, unknown>
    );
  }

  // ==================== Guild Commands ====================

  /**
   * Get guild application commands
   */
  async getGuildCommands(
    guildId: Snowflake,
    withLocalizations?: boolean
  ): Promise<ApplicationCommand[]> {
    const appId = this.getAppId();
    return this.client.get<ApplicationCommand[]>(
      `/applications/${appId}/guilds/${guildId}/commands`,
      { with_localizations: withLocalizations }
    );
  }

  /**
   * Create a guild application command
   */
  async createGuildCommand(
    guildId: Snowflake,
    options: CreateApplicationCommandOptions
  ): Promise<ApplicationCommand> {
    const appId = this.getAppId();
    return this.client.post<ApplicationCommand>(
      `/applications/${appId}/guilds/${guildId}/commands`,
      options
    );
  }

  /**
   * Get a guild application command
   */
  async getGuildCommand(
    guildId: Snowflake,
    commandId: Snowflake
  ): Promise<ApplicationCommand> {
    const appId = this.getAppId();
    return this.client.get<ApplicationCommand>(
      `/applications/${appId}/guilds/${guildId}/commands/${commandId}`
    );
  }

  /**
   * Edit a guild application command
   */
  async editGuildCommand(
    guildId: Snowflake,
    commandId: Snowflake,
    options: Partial<CreateApplicationCommandOptions>
  ): Promise<ApplicationCommand> {
    const appId = this.getAppId();
    return this.client.patch<ApplicationCommand>(
      `/applications/${appId}/guilds/${guildId}/commands/${commandId}`,
      options
    );
  }

  /**
   * Delete a guild application command
   */
  async deleteGuildCommand(guildId: Snowflake, commandId: Snowflake): Promise<void> {
    const appId = this.getAppId();
    return this.client.delete(
      `/applications/${appId}/guilds/${guildId}/commands/${commandId}`
    );
  }

  /**
   * Bulk overwrite guild application commands
   */
  async bulkOverwriteGuildCommands(
    guildId: Snowflake,
    commands: CreateApplicationCommandOptions[]
  ): Promise<ApplicationCommand[]> {
    const appId = this.getAppId();
    return this.client.put<ApplicationCommand[]>(
      `/applications/${appId}/guilds/${guildId}/commands`,
      commands as unknown as Record<string, unknown>
    );
  }

  // ==================== Command Permissions ====================

  /**
   * Get guild application command permissions
   */
  async getGuildCommandPermissions(guildId: Snowflake) {
    const appId = this.getAppId();
    return this.client.get(
      `/applications/${appId}/guilds/${guildId}/commands/permissions`
    );
  }

  /**
   * Get application command permissions
   */
  async getCommandPermissions(guildId: Snowflake, commandId: Snowflake) {
    const appId = this.getAppId();
    return this.client.get(
      `/applications/${appId}/guilds/${guildId}/commands/${commandId}/permissions`
    );
  }

  /**
   * Edit application command permissions
   */
  async editCommandPermissions(
    guildId: Snowflake,
    commandId: Snowflake,
    permissions: Array<{
      id: Snowflake;
      type: number;
      permission: boolean;
    }>
  ) {
    const appId = this.getAppId();
    return this.client.put(
      `/applications/${appId}/guilds/${guildId}/commands/${commandId}/permissions`,
      { permissions }
    );
  }
}
