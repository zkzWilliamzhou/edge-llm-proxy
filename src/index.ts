/**
 * Edge LLM Proxy
 * 
 * Zero-config LLM proxy optimized for edge runtimes with automatic caching,
 * rate limiting, token management, and runtime-agnostic API.
 * 
 * @package edge-llm-proxy
 * @version 0.1.0
 * @license MIT
 */

// Core exports
export {
  LLMProxy,
  createProxy,
  type ProxyConfig,
  type ProxyOptions,
  type LLMRequest,
  type LLMResponse,
  type LLMProvider,
  type ModelConfig,
} from './core/proxy';

// Edge runtime adapters
export {
  createCloudflareHandler,
  type CloudflareContext,
} from './edge/cloudflare';

export {
  createDenoHandler,
  type DenoContext,
} from './edge/deno';

export {
  createVercelHandler,
  type VercelContext,
} from './edge/vercel';

// Cache
export {
  MemoryCache,
  UpstashRedisCache,
  type CacheAdapter,
  type CacheOptions,
} from './cache';

// Rate limiting
export {
  TokenBucketRateLimiter,
  SlidingWindowRateLimiter,
  type RateLimiter,
  type RateLimitConfig,
  type RateLimitInfo,
} from './rate-limit';

// Auth
export {
  APIKeyAuth,
  BearerTokenAuth,
  type AuthStrategy,
  type AuthConfig,
} from './auth';

// Types
export * from './types';

// Default export
import { LLMProxy, createProxy } from './core/proxy';

export default {
  LLMProxy,
  createProxy,
};