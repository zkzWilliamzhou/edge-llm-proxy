/**
 * Auth Module
 * 
 * Authentication strategies for the LLM proxy.
 * Supports API key and bearer token authentication.
 */

import { AuthStrategy, AuthResult, AuthConfig, LLMRequest } from '../types';

/**
 * API Key Authentication
 * 
 * Validates requests using an API key provided in a header.
 */
export class APIKeyAuth implements AuthStrategy {
  private readonly apiKeys: Set<string>;
  private readonly headerName: string;

  constructor(config: {
    apiKeys: string[];
    headerName?: string;
  }) {
    this.apiKeys = new Set(config.apiKeys);
    this.headerName = config.headerName ?? 'x-api-key';
  }

  /**
   * Authenticate a request
   */
  async authenticate(request: LLMRequest): Promise<AuthResult> {
    const apiKey = request.headers[this.headerName.toLowerCase()];

    if (!apiKey) {
      return { success: false, error: 'API key header missing' };
    }

    if (!this.apiKeys.has(apiKey)) {
      return { success: false, error: 'Invalid API key' };
    }

    return { success: true, key: apiKey };
  }

  /**
   * Extract the API key from a request
   */
  getKey(request: LLMRequest): string | null {
    return request.headers[this.headerName.toLowerCase()] || null;
  }

  /**
   * Check if the provided key is valid
   */
  validateKey(key: string): boolean {
    return this.apiKeys.has(key);
  }

  /**
   * Get all valid keys (for debugging - use sparingly)
   */
  getValidKeys(): string[] {
    return Array.from(this.apiKeys);
  }

  /**
   * Add a new valid key
   */
  addKey(key: string): void {
    this.apiKeys.add(key);
  }

  /**
   * Remove a valid key
   */
  removeKey(key: string): void {
    this.apiKeys.delete(key);
  }

  toJSON(): {
    apiKeyCount: number;
    headerName: string;
    validKeys: string[];
  } {
    return {
      apiKeyCount: this.apiKeys.size,
      headerName: this.headerName,
      validKeys: Array.from(this.apiKeys),
    };
  }
}

/**
 * Bearer Token Authentication
 * 
 * Validates requests using a Bearer token in the Authorization header.
 */
export class BearerTokenAuth implements AuthStrategy {
  private readonly validTokens: Set<string>;

  constructor(config: {
    validTokens: string[];
  }) {
    this.validTokens = new Set(config.validTokens);
  }

  /**
   * Authenticate a request
   */
  async authenticate(request: LLMRequest): Promise<AuthResult> {
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'Authorization header missing or invalid' };
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    if (!this.validTokens.has(token)) {
      return { success: false, error: 'Invalid bearer token' };
    }

    return { success: true, key: token };
  }

  /**
   * Extract the bearer token from a request
   */
  getKey(request: LLMRequest): string | null {
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return null;
  }

  /**
   * Check if the provided token is valid
   */
  validateToken(token: string): boolean {
    return this.validTokens.has(token);
  }

  /**
   * Get all valid tokens (for debugging - use sparingly)
   */
  getValidTokens(): string[] {
    return Array.from(this.validTokens);
  }

  /**
   * Add a new valid token
   */
  addToken(token: string): void {
    this.validTokens.add(token);
  }

  /**
   * Remove a valid token
   */
  removeToken(token: string): void {
    this.validTokens.delete(token);
  }

  toJSON(): {
    tokenCount: number;
    validTokens: string[];
  } {
    return {
      tokenCount: this.validTokens.size,
      validTokens: Array.from(this.validTokens),
    };
  }
}

/**
 * Auth factory
 */
export const createAuth = (config: {
  strategy: 'api-key' | 'bearer-token';
  apiKeys?: string[];
  validTokens?: string[];
  headerName?: string;
}): AuthStrategy => {
  const { strategy, apiKeys, validTokens, headerName } = config;

  switch (strategy) {
    case 'api-key':
      if (!apiKeys || apiKeys.length === 0) {
        throw new Error('API keys must be provided for API key authentication');
      }
      return new APIKeyAuth({ apiKeys, headerName });
    case 'bearer-token':
      if (!validTokens || validTokens.length === 0) {
        throw new Error('Valid tokens must be provided for bearer token authentication');
      }
      return new BearerTokenAuth({ validTokens });
    default:
      throw new Error(`Unknown authentication strategy: ${strategy}`);
  }
};

/**
 * Auth utilities
 */
export const authUtils = {
  /**
   * Generate auth key from request for monitoring
   */
  generateKey: (request: Request, config: { ipHeader?: string } = {}): string => {
    const ip = request.headers.get(config.ipHeader || 'x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    return `${ip}:${userAgent}`;
  },

  /**
   * Parse auth info from Authorization header
   */
  parseBearerToken: (header: string | null): { valid: boolean; token: string | null } => {
    if (!header) return { valid: false, token: null };
    if (!header.startsWith('Bearer ')) return { valid: false, token: null };
    return { valid: true, token: header.slice(7) };
  },

  /**
   * Check if auth is present in request
   */
  hasAuth: (request: Request, config: { apiKeyHeader?: string } = {}): boolean => {
    const header = request.headers.get(config.apiKeyHeader || 'authorization');
    if (!header) return false;
    if (header.toLowerCase().startsWith('bearer ')) return true;
    return header.toLowerCase().startsWith('api-key') || header.toLowerCase().startsWith('x-api-key');
  },

  /**
   * Extract auth value from request
   */
  extractAuthValue: (request: Request, config: { apiKeyHeader?: string }): string | null => {
    const header = request.headers.get(config.apiKeyHeader || 'authorization');
    if (!header) return null;
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7);
    if (header.toLowerCase().startsWith('api-key') || header.toLowerCase().startsWith('x-api-key')) {
      return header.split(':')[1]?.trim() || header.slice(5).trim();
    }
    return null;
  },
};

/**
 * Example: Environment-based auth config
 */
export const authFromEnv = (): {
  strategy: 'api-key' | 'bearer-token';
  config: { apiKeys: string[]; validTokens: string[]; headerName?: string };
} => {
  // Parse comma-separated API keys from environment
  const apiKeysEnv = process.env.LLM_API_KEYS;
  const validTokensEnv = process.env.LLM_API_TOKENS;

  let apiKeys: string[] = [];
  let validTokens: string[] = [];

  if (apiKeysEnv) {
    apiKeys = apiKeysEnv.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  if (validTokensEnv) {
    validTokens = validTokensEnv.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  // Determine strategy based on what's configured
  const strategy: 'api-key' | 'bearer-token' = apiKeys.length > 0
    ? (validTokens.length > 0 ? 'both' : 'api-key')
    : (validTokens.length > 0 ? 'bearer-token' : 'none');

  return {
    strategy,
    config: {
      apiKeys,
      validTokens,
      headerName: process.env.LLM_API_KEY_HEADER || 'x-api-key',
    },
  };
};