/**
 * Rate Limit Module
 * 
 * Rate limiter implementations for the LLM proxy.
 * Supports token bucket and sliding window algorithms.
 */

import { RateLimiter, RateLimitConfig, RateLimitInfo } from '../types';

/**
 * Token Bucket Rate Limiter
 * 
 * Allows a configurable number of requests per interval, with tokens refilling
 * linearly over time. Most common and fair rate limiting algorithm.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private tokensPerInterval: number;
  private intervalMs: number;

  constructor(tokensPerInterval: number = 100, intervalMs: number = 60000) {
    this.tokensPerInterval = tokensPerInterval;
    this.intervalMs = intervalMs;
  }

  /**
   * Internal: Refill tokens based on elapsed time
   */
  private refill(bucket: { tokens: number; lastRefill: number }): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor((elapsed / this.intervalMs) * this.tokensPerInterval);

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.tokensPerInterval, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  /**
   * Check if request is allowed within rate limit
   */
  async checkLimit(key: string): Promise<RateLimitInfo> {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.tokensPerInterval, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    this.refill(bucket);

    return {
      allowed: bucket.tokens > 0,
      remaining: bucket.tokens,
      resetAt: bucket.lastRefill + this.intervalMs,
      total: this.tokensPerInterval,
    };
  }

  /**
   * Increment token usage and return updated info
   */
  async increment(key: string): Promise<RateLimitInfo> {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.tokensPerInterval, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    this.refill(bucket);

    if (bucket.tokens > 0) {
      bucket.tokens--;
    }

    return {
      allowed: bucket.tokens >= 0,
      remaining: Math.max(0, bucket.tokens),
      resetAt: bucket.lastRefill + this.intervalMs,
      total: this.tokensPerInterval,
      retryAfter: bucket.tokens <= 0 ? this.intervalMs : undefined,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /**
   * Get current rate limit status for a key
   */
  async getLimit(key: string): Promise<RateLimitInfo> {
    return this.checkLimit(key);
  }

  /**
   * Get total tokens in bucket
   */
  getTokens(): number {
    return this.tokensPerInterval;
  }

  /**
   * Get time until next token refill (ms)
   */
  getTimeUntilRefill(key: string): number {
    let bucket = this.buckets.get(key);
    if (!bucket) return this.intervalMs;

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const remainingTime = Math.max(0, this.intervalMs - elapsed);
    return remainingTime;
  }

  /**
   * Get all tracked keys (for debugging/monitoring)
   */
  getKeys(): string[] {
    return Array.from(this.buckets.keys());
  }
}

/**
 * Sliding Window Rate Limiter
 * 
 * Tracks timestamps of recent requests and determines if the limit is exceeded
 * within a sliding time window. More accurate for burst-aware rate limiting.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private windows = new Map<string, number[]>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Internal: Clean timestamps outside the window
   */
  private cleanWindow(timestamps: number[]): number[] {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    return timestamps.filter(timestamp => timestamp > cutoff);
  }

  /**
   * Check if request is allowed within rate limit
   */
  async checkLimit(key: string): Promise<RateLimitInfo> {
    let timestamps = this.windows.get(key) || [];
    timestamps = this.cleanWindow(timestamps);

    return {
      allowed: timestamps.length < this.maxRequests,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      resetAt: Date.now() + this.windowMs,
      total: this.maxRequests,
    };
  }

  /**
   * Increment request count and return updated info
   */
  async increment(key: string): Promise<RateLimitInfo> {
    let timestamps = this.windows.get(key) || [];
    timestamps = this.cleanWindow(timestamps);

    const allowed = timestamps.length < this.maxRequests;

    if (allowed) {
      timestamps.push(Date.now());
      this.windows.set(key, timestamps);
    }

    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      resetAt: Date.now() + this.windowMs,
      total: this.maxRequests,
      retryAfter: allowed ? undefined : this.windowMs,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  /**
   * Get current rate limit status for a key
   */
  async getLimit(key: string): Promise<RateLimitInfo> {
    return this.checkLimit(key);
  }

  /**
   * Get total request capacity
   */
  getCapacity(): number {
    return this.maxRequests;
  }

  /**
   * Get time until window resets (ms)
   */
  getTimeUntilReset(key: string): number {
    let timestamps = this.windows.get(key) || [];

    if (timestamps.length === 0) return this.windowMs;

    // Get the oldest timestamp in the window
    const sorted = [...timestamps].sort((a, b) => a - b);
    const oldest = sorted[0];
    return Math.max(0, this.windowMs - (Date.now() - oldest));
  }

  /**
   * Get all tracked keys (for debugging/monitoring)
   */
  getKeys(): string[] {
    return Array.from(this.windows.keys());
  }
}

/**
 * Fixed Window Rate Limiter
 * 
 * Simple rate limiter that resets at fixed intervals. Easier to reason about
 * but may allow bursts at interval boundaries.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  private windows = new Map<string, { count: number; windowStart: number }>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Internal: Get or create window for key
   */
  private getWindow(key: string): { count: number; windowStart: number } | null {
    const now = Date.now();
    const windowEntry = this.windows.get(key);

    if (windowEntry) {
      // Check if window has expired
      if (now - windowEntry.windowStart > this.windowMs) {
        // Window expired, create new one
        return { count: 1, windowStart: now };
      }
      return windowEntry;
    }

    // New window
    return { count: 1, windowStart: now };
  }

  /**
   * Check if request is allowed within rate limit
   */
  async checkLimit(key: string): Promise<RateLimitInfo> {
    const window = this.getWindow(key);

    if (!window) {
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt: this.windowMs,
        total: this.maxRequests,
      };
    }

    return {
      allowed: window.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - window.count),
      resetAt: window.windowStart + this.windowMs,
      total: this.maxRequests,
    };
  }

  /**
   * Increment request count and return updated info
   */
  async increment(key: string): Promise<RateLimitInfo> {
    const window = this.getWindow(key);

    return {
      allowed: window.count < this.maxRequests,
      remaining: Math.max(0, this.maxRequests - window.count - 1),
      resetAt: window.windowStart + this.windowMs,
      total: this.maxRequests,
      retryAfter: window.count >= this.maxRequests ? this.windowMs : undefined,
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  /**
   * Get current rate limit status for a key
   */
  async getLimit(key: string): Promise<RateLimitInfo> {
    return this.checkLimit(key);
  }

  /**
   * Get all tracked keys
   */
  getKeys(): string[] {
    return Array.from(this.windows.keys());
  }
}

/**
 * Rate limit factory
 */
export const createRateLimiter = (config: {
  algorithm: 'token-bucket' | 'sliding-window' | 'fixed-window';
  maxRequests?: number;
  intervalMs?: number;
  windowMs?: number;
}): RateLimiter => {
  const {
    algorithm = 'token-bucket',
    maxRequests = 100,
    intervalMs = 60000,
    windowMs = 60000,
  } = config;

  switch (algorithm) {
    case 'token-bucket':
      return new TokenBucketRateLimiter(maxRequests, intervalMs);
    case 'sliding-window':
      return new SlidingWindowRateLimiter(windowMs, maxRequests);
    case 'fixed-window':
      return new FixedWindowRateLimiter(windowMs, maxRequests);
    default:
      return new TokenBucketRateLimiter(maxRequests, intervalMs);
  }
};

/**
 * Rate limit utilities
 */
export const rateLimitUtils = {
  /**
   * Generate a rate limit key from request
   */
  generateKey: (request: Request, config: { ipHeader?: string; pathHeader?: string } = {}): string => {
    const ip = request.headers.get(config.ipHeader || 'x-forwarded-for') || 'unknown';
    const path = request.url || 'unknown';
    return `${ip}:${path}`;
  },

  /**
   * Parse rate limit headers from response
   */
  parseHeaders: (headers: Headers): {
    limit: number;
    remaining: number;
    reset: number;
  } => {
    const limit = headers.get('x-ratelimit-limit') 
      ? parseInt(headers.get('x-ratelimit-limit')!) 
      : 100;
    const remaining = headers.get('x-ratelimit-remaining') 
      ? parseInt(headers.get('x-ratelimit-remaining')!) 
      : limit;
    const reset = headers.get('x-ratelimit-reset') 
      ? Math.ceil(parseInt(headers.get('x-ratelimit-reset')!) * 1000) 
      : 0;

    return { limit, remaining, reset };
  },

  /**
   * Format rate limit info for response headers
   */
  formatHeaders: (info: {
    limit: number;
    remaining: number;
    reset: number;
  }): HeadersInit => {
    return {
      'x-ratelimit-limit': String(info.limit),
      'x-ratelimit-remaining': String(info.remaining),
      'x-ratelimit-reset': String(info.reset),
    };
  },
};

/**
 * Example: Distributed rate limiting with Redis
 * 
 * In production, install @upstash/redis and use:
 * ```typescript
 * import { createClient } from '@upstash/redis';
 * 
 * const redis = createClient({
 *   url: process.env.UPSTASH_REDIS_URL!,
 *   token: process.env.UPSTASH_REDIS_TOKEN!,
 * });
 * 
 * class DistributedRateLimiter implements RateLimiter {
 *   private redis: ReturnType<typeof createClient>;
 *   
 *   async checkLimit(key: string): Promise<RateLimitInfo> {
 *     const incrementResult = await redis.incr(key);
 *     const ttl = await redis.expire(key, 60000); // 1 minute TTL
 *     
 *     return {
 *       allowed: incrementResult <= 100, // Max 100 requests per minute
 *       remaining: Math.max(0, 100 - incrementResult),
 *       resetAt: Date.now() + 60000,
 *       total: 100,
 *     };
 *   }
 *   // etc...
 * }
 * ```
 */
export { TokenBucketRateLimiter, SlidingWindowRateLimiter, FixedWindowRateLimiter, createRateLimiter };