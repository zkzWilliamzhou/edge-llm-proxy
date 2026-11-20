/**
 * Auth Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { APIKeyAuth, BearerTokenAuth, createAuth } from '../src/auth';

describe('APIKeyAuth', () => {
  let auth: APIKeyAuth;

  beforeEach(() => {
    auth = new APIKeyAuth({
      apiKeys: ['valid-key-1', 'valid-key-2', 'valid-key-3'],
      headerName: 'x-api-key',
    });
  });

  it('should authenticate valid key', async () => {
    const result = await auth.authenticate({
      headers: { 'x-api-key': 'valid-key-1' },
    } as any);

    expect(result.success).toBe(true);
    expect(result.key).toBe('valid-key-1');
  });

  it('should reject invalid key', async () => {
    const result = await auth.authenticate({
      headers: { 'x-api-key': 'invalid-key' },
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid API key');
  });

  it('should reject missing key', async () => {
    const result = await auth.authenticate({
      headers: {},
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe('API key header missing');
  });

  it('should validate key', () => {
    expect(auth.validateKey('valid-key-1')).toBe(true);
    expect(auth.validateKey('invalid-key')).toBe(false);
  });

  it('should add and remove key', () => {
    auth.addKey('new-key');
    expect(auth.validateKey('new-key')).toBe(true);

    auth.removeKey('new-key');
    expect(auth.validateKey('new-key')).toBe(false);
  });
});

describe('BearerTokenAuth', () => {
  let auth: BearerTokenAuth;

  beforeEach(() => {
    auth = new BearerTokenAuth({
      validTokens: ['token-1', 'token-2', 'token-3'],
    });
  });

  it('should authenticate valid token', async () => {
    const result = await auth.authenticate({
      headers: { authorization: 'Bearer token-1' },
    } as any);

    expect(result.success).toBe(true);
    expect(result.key).toBe('token-1');
  });

  it('should reject invalid token', async () => {
    const result = await auth.authenticate({
      headers: { authorization: 'Bearer invalid-token' },
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid bearer token');
  });

  it('should reject missing token', async () => {
    const result = await auth.authenticate({
      headers: {},
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Authorization header missing or invalid');
  });

  it('should validate token', () => {
    expect(auth.validateToken('token-1')).toBe(true);
    expect(auth.validateToken('invalid-token')).toBe(false);
  });

  it('should add and remove token', () => {
    auth.addToken('new-token');
    expect(auth.validateToken('new-token')).toBe(true);

    auth.removeToken('new-token');
    expect(auth.validateToken('new-token')).toBe(false);
  });
});

describe('createAuth factory', () => {
  it('should create API key auth', () => {
    const auth = createAuth({
      strategy: 'api-key',
      apiKeys: ['key1', 'key2'],
    });

    expect(auth).toBeInstanceOf(APIKeyAuth);
  });

  it('should create bearer token auth', () => {
    const auth = createAuth({
      strategy: 'bearer-token',
      validTokens: ['token1', 'token2'],
    });

    expect(auth).toBeInstanceOf(BearerTokenAuth);
  });
});