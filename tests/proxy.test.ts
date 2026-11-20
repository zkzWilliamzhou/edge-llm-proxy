/**
 * Proxy Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LLMProxy, createProxy, DEFAULT_CONFIG } from '../src/core/proxy';
import { MemoryCache } from '../src/cache';
import { TokenBucketRateLimiter } from '../src/rate-limit';
import { APIKeyAuth } from '../src/auth';
import { Request } from 'undici';

describe('LLMProxy', () => {
  let proxy: LLMProxy;
  let mockRequest: Request;

  beforeEach(() => {
    // Create proxy with minimal config
    proxy = createProxy({
      config: {
        ...DEFAULT_CONFIG,
        models: {
          'gpt-3.5-turbo': {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
          },
        },
        cache: {
          enabled: false, // Disable cache in tests
        },
        rateLimit: {
          enabled: false, // Disable rate limit in tests
        },
        auth: {
          enabled: false, // Disable auth in tests
        },
      },
    });

    mockRequest = new Request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer test-key-123',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
  });

  afterEach(() => {
    proxy.resetMetrics();
  });

  describe('handle method', () => {
    it('should handle CORS preflight request', async () => {
      const corsRequest = new Request('https://example.com/api/llm-proxy', {
        method: 'OPTIONS',
      });

      const response = await proxy.handle(corsRequest);
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('should handle POST request to proxy', async () => {
      const response = await proxy.handle(mockRequest);
      expect([200, 401, 429, 500]).toContain(response.status);
    });

    it('should return error for invalid request', async () => {
      const invalidRequest = new Request('https://example.com/', {
        method: 'GET',
      });

      const response = await proxy.handle(invalidRequest);
      expect(response.status).toBe(400);
    });
  });

  describe('metrics', () => {
    it('should track request metrics', async () => {
      await proxy.handle(mockRequest);
      const metrics = proxy.getMetrics();

      expect(metrics.requests.total).toBeGreaterThan(0);
      expect(metrics.errors).toBeDefined();
    });

    it('should reset metrics', () => {
      proxy.resetMetrics();
      const metrics = proxy.getMetrics();

      expect(metrics.requests.total).toBe(0);
    });
  });

  describe('health check', () => {
    it('should return healthy status', async () => {
      const health = await proxy.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.timestamp).toBeDefined();
      expect(health.version).toBe('0.1.0');
    });
  });

  describe('cache', () => {
    it('should have cache implemented', () => {
      const cache = new MemoryCache({ maxSize: 100, ttl: 60000 });
      expect(cache).toBeDefined();
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
    });

    it('should cache entries and expire', async () => {
      const cache = new MemoryCache({ ttl: 10 }); // 10ms TTL

      await cache.set('test-key', { data: 'value' });
      expect(cache.has('test-key')).toBe(true);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(cache.has('test-key')).toBe(false);
    });
  });

  describe('rate limiter', () => {
    it('should have rate limiter implemented', () => {
      const limiter = new TokenBucketRateLimiter(10, 60000);
      expect(limiter).toBeDefined();
      expect(typeof limiter.checkLimit).toBe('function');
      expect(typeof limiter.increment).toBe('function');
    });

    it('should allow and track requests', async () => {
      const limiter = new TokenBucketRateLimiter(5, 60000);

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const info = await limiter.checkLimit('test-key');
        expect(info.allowed).toBe(true);
        await limiter.increment('test-key');
      }

      // 6th request should be denied
      const info = await limiter.checkLimit('test-key');
      expect(info.allowed).toBe(false);
    });
  });

  describe('auth', () => {
    it('should have API key auth implemented', () => {
      const auth = new APIKeyAuth({
        apiKeys: ['key-1', 'key-2', 'key-3'],
        headerName: 'x-api-key',
      });
      expect(auth).toBeDefined();
    });

    it('should validate API key', async () => {
      const auth = new APIKeyAuth({
        apiKeys: ['valid-key'],
        headerName: 'x-api-key',
      });

      // Valid key
      const result1 = await auth.authenticate({
        headers: { 'x-api-key': 'valid-key' },
      } as any);
      expect(result1.success).toBe(true);

      // Invalid key
      const result2 = await auth.authenticate({
        headers: { 'x-api-key': 'invalid-key' },
      } as any);
      expect(result2.success).toBe(false);
    });
  });
});