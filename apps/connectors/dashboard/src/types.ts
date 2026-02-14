export interface AuthStatus {
  type: "oauth" | "apikey" | "bearer";
  configured: boolean;
  tokenExpiry?: number;
  hasRefreshToken?: boolean;
  envVars: { variable: string; description: string; set: boolean }[];
}

export interface ConnectorWithAuth {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  installed: boolean;
  auth: AuthStatus | null;
}
