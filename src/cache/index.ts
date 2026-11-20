/**
 * Cache Module
 * 
 * Cache adapter implementations for the LLM proxy.
 * Supports memory caching and Upstash Redis (via separate package).
 */

import { CacheAdapter, CacheEntry, CacheConfig } from '../types';

/**
 * In-memory cache implementation
 */
export class MemoryCache implements CacheAdapter {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttl: number;
  private staleWhileRevalidate: number;

  constructor(config: {
    maxSize?: number;
    ttl?: number;
    staleWhileRevalidate?: number;
  } = {}) {
    this.maxSize = config.maxSize ?? 1000;
    this.ttl = config.ttl ?? 5 * 60 * 1000; // 5 minutes
    this.staleWhileRevalidate = config.staleWhileRevalidate ?? 60 * 1000; // 1 minute
  }

  async get(key: string): Promise<CacheEntry | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (entry.expiresAt < now) {
      // Expired - remove from cache
      this.cache.delete(key);
      return null;
    }

    // Return entry, possibly stale
    if (entry.hits > 0 && now - entry.lastAccessed > this.staleWhileRevalidate) {
      // Entry is stale but can be used
      return {
        ...entry,
        stale: true,
      };
    }

    entry.lastAccessed = now;
    return entry;
  }

  async set(key: string, value: any, ttlOverride?: number): Promise<void> {
    const now = Date.now();
    const expiresAt = now + (ttlOverride ?? this.ttl);
    const lastAccessed = now;

    // Enforce max size
    if (this.cache.size >= this.maxSize) {
      // Find and remove least recently accessed entry
      let oldestKey = '';
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt,
      lastAccessed,
      createdAt: now,
      hits: 0,
      stale: false,
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }

  /**
   * Get entry value
   */
  getValue(key: string): any {
    const entry = this.cache.get(key);
    return entry ? entry.value : null;
  }

  /**
   * Increment hit counter
   */
  incrementHits(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      entry.hits++;
      entry.lastAccessed = Date.now();
    }
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    const now = Date.now();
    return entry.expiresAt > now;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalEntries: number;
    totalHits: number;
    missCount: number;
    hitRate: number;
    memoryUsage: number;
  } {
    let totalHits = 0;
    let missCount = 0;

    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }

    return {
      totalEntries: this.cache.size,
      totalHits,
      missCount: 0, // Would track separately in production
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      memoryUsage: 0, // Would track in production
    };
  }
}

/**
 * Convenience functions
 */
export const createMemoryCache = (config?: {
  maxSize?: number;
  ttl?: number;
  staleWhileRevalidate?: number;
}): MemoryCache => new MemoryCache(config);

export const defaultCacheConfig = {
  maxSize: 1000,
  ttl: 5 * 60 * 1000,
  staleWhileRevalidate: 60 * 1000,
};

/**
 * Example: Upstash Redis cache adapter (placeholder)
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
 * class UpstashCache implements CacheAdapter {
 *   private redis: ReturnType<typeof createClient>;
 *   
 *   async get(key: string) {
 *     const data = await redis.get(key);
 *     if (!data) return null;
 *     return JSON.parse(data);
 *   }
 *   
 *   async set(key: string, value: any) {
 *     await redis.set(key, JSON.stringify(value));
 *   }
 *   // ... etc
 * }
 * ```
 */
export { MemoryCache, createMemoryCache, defaultCacheConfig };