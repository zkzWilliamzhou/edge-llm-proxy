/**
 * Core LLM Proxy Implementation
 * 
 * Handles request routing, caching, rate limiting, and provider communication.
 * Runtime-agnostic core that can be used in any edge environment.
 */

import {
  LLMRequest,
  LLMResponse,
  ModelConfig,
  ProxyConfig,
  ProxyOptions,
  ProxyHooks,
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  Usage,
  CacheAdapter,
  RateLimiter,
  AuthStrategy,
  Logger,
  HealthCheckResponse,
  Metrics,
  RateLimitInfo,
  AuthResult,
} from '../types';

/**
 * Default configurations
 */
const DEFAULT_CONFIG: Partial<ProxyConfig> = {
  defaultModel: 'gpt-3.5-turbo',
  cache: {
    enabled: true,
    adapter: 'memory',
    maxSize: 1000,
    ttl: 5 * 60 * 1000, // 5 minutes
    staleWhileRevalidate: 60 * 1000, // 1 minute
  },
  rateLimit: {
    enabled: true,
    algorithm: 'token-bucket',
    tokensPerInterval: 100,
    interval: 60 * 1000, // 1 minute
  },
  auth: {
    enabled: false,
    strategy: 'api-key',
    apiKeyHeader: 'x-api-key',
  },
  logging: {
    enabled: true,
    level: 'info',
    maskSensitiveHeaders: ['authorization', 'x-api-key', 'api-key'],
  },
  cors: {
    enabled: true,
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-api-key'],
  },
  timeout: {
    connect: 10000,
    request: 60000,
    response: 60000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    retryDelay: 1000,
    retryDelayMax: 10000,
    retryJitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504],
  },
};

/**
 * In-memory cache implementation
 */
class MemoryCacheImpl implements CacheAdapter {
  private cache = new Map<string, any>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  async get(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    if (entry.expiresAt < now) {
      this.cache.delete(key);
      return null;
    }
    
    entry.hits++;
    return entry;
  }

  async set(key: string, entry: any) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, entry);
  }

  async delete(key: string) {
    this.cache.delete(key);
  }

  async clear() {
    this.cache.clear();
  }

  async keys() {
    return Array.from(this.cache.keys());
  }
}

/**
 * Token bucket rate limiter
 */
class TokenBucketLimiter implements RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private tokensPerInterval: number;
  private intervalMs: number;

  constructor(tokensPerInterval = 100, intervalMs = 60000) {
    this.tokensPerInterval = tokensPerInterval;
    this.intervalMs = intervalMs;
  }

  private refill(bucket: { tokens: number; lastRefill: number }) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor((elapsed / this.intervalMs) * this.tokensPerInterval);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.tokensPerInterval, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

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

  async reset(key: string) {
    this.buckets.delete(key);
  }

  async getLimit(key: string) {
    return this.checkLimit(key);
  }
}

/**
 * Sliding window rate limiter
 */
class SlidingWindowLimiter implements RateLimiter {
  private windows = new Map<string, number[]>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  private cleanWindow(timestamps: number[]) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    return timestamps.filter(t => t > cutoff);
  }

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

  async reset(key: string) {
    this.windows.delete(key);
  }

  async getLimit(key: string) {
    return this.checkLimit(key);
  }
}

/**
 * Default logger
 */
class DefaultLogger implements Logger {
  private level: 'debug' | 'info' | 'warn' | 'error';
  private levels = { debug: 0, info: 1, warn: 2, error: 3 };

  constructor(level = 'info') {
    this.level = level;
  }

  private shouldLog(level: string) {
    return this.levels[level] >= this.levels[this.level];
  }

  private formatMessage(level: string, message: string, meta?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('debug')) console.debug(this.formatMessage('debug', message, meta));
  }

  info(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('info')) console.info(this.formatMessage('info', message, meta));
  }

  warn(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('warn')) console.warn(this.formatMessage('warn', message, meta));
  }

  error(message: string, meta?: Record<string, any>) {
    if (this.shouldLog('error')) console.error(this.formatMessage('error', message, meta));
  }
}

/**
 * Main LLM Proxy Class
 */
export class LLMProxy {
  private config: ProxyConfig;
  private cache: CacheAdapter;
  private rateLimiter: RateLimiter;
  private auth: AuthStrategy;
  private logger: Logger;
  private hooks: ProxyHooks;
  private fetchImpl: typeof fetch;
  private startTime: number;
  private metrics: Metrics;

  constructor(options: ProxyOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options.config } as ProxyConfig;
    this.fetchImpl = options.fetch || fetch.bind(globalThis);
    this.startTime = Date.now();
    this.hooks = {};
    this.metrics = this.initMetrics();

    // Initialize components
    this.cache = this.createCache();
    this.rateLimiter = this.createRateLimiter();
    this.auth = this.createAuth();
    this.logger = this.createLogger();

    // Log startup
    this.logger.info('LLM Proxy initialized', {
      defaultModel: this.config.defaultModel,
      cacheEnabled: this.config.cache?.enabled,
      rateLimitEnabled: this.config.rateLimit?.enabled,
      authEnabled: this.config.auth?.enabled,
    });
  }

  private initMetrics(): Metrics {
    return {
      requests: { total: 0, successful: 0, failed: 0, cached: 0, rateLimited: 0 },
      latency: { p50: 0, p95: 0, p99: 0 },
      tokens: { prompt: 0, completion: 0, total: 0 },
      errors: {},
    };
  }

  private createCache(): CacheAdapter {
    const cacheConfig = this.config.cache!;
    if (!cacheConfig.enabled) {
      return {
        get: async () => null,
        set: async () => {},
        delete: async () => {},
        clear: async () => {},
        keys: async () => [],
      };
    }

    switch (cacheConfig.adapter) {
      case 'upstash-redis':
        // Would need upstash-redis package
        this.logger.warn('Upstash Redis adapter not implemented, falling back to memory');
        return new MemoryCacheImpl(cacheConfig.maxSize);
      case 'custom':
        return cacheConfig.customAdapter!;
      default:
        return new MemoryCacheImpl(cacheConfig.maxSize!);
    }
  }

  private createRateLimiter(): RateLimiter {
    const rlConfig = this.config.rateLimit!;
    if (!rlConfig.enabled) {
      return {
        checkLimit: async () => ({ allowed: true, remaining: Infinity, resetAt: 0, total: Infinity }),
        increment: async () => ({ allowed: true, remaining: Infinity, resetAt: 0, total: Infinity }),
        reset: async () => {},
        getLimit: async () => ({ allowed: true, remaining: Infinity, resetAt: 0, total: Infinity }),
      };
    }

    switch (rlConfig.algorithm) {
      case 'sliding-window':
        return new SlidingWindowLimiter(
          rlConfig.windowMs!,
          rlConfig.maxRequests!
        );
      default:
        return new TokenBucketLimiter(
          rlConfig.tokensPerInterval!,
          rlConfig.interval!
        );
    }
  }

  private createAuth(): AuthStrategy {
    const authConfig = this.config.auth!;
    if (!authConfig.enabled) {
      return {
        authenticate: async () => ({ success: true }),
        getKey: async (req) => req.headers[authConfig.apiKeyHeader!.toLowerCase()] || 'anonymous',
      };
    }

    switch (authConfig.strategy) {
      case 'bearer-token':
        return new BearerTokenAuthImpl(authConfig);
      default:
        return new APIKeyAuthImpl(authConfig);
    }
  }

  private createLogger(): Logger {
    const logConfig = this.config.logging!;
    if (!logConfig.enabled) {
      return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
    }
    return logConfig.customLogger || new DefaultLogger(logConfig.level);
  }

  /**
   * Handle incoming request
   */
  async handle(request: Request): Promise<Response> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID().slice(0, 8);
    
    this.logger.debug('Incoming request', { requestId, method: request.method, url: request.url });

    try {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return this.handleCORS(request);
      }

      // Parse request
      const llmRequest = await this.parseRequest(request);
      
      // Authentication
      const authResult = await this.auth.authenticate(llmRequest);
      if (!authResult.success) {
        return this.createErrorResponse(401, authResult.error || 'Unauthorized');
      }
      const authKey = authResult.key || 'anonymous';

      // Rate limiting
      const rateLimitInfo = await this.rateLimiter.increment(authKey);
      if (!rateLimitInfo.allowed) {
        this.metrics.requests.rateLimited++;
        this.logger.warn('Rate limit exceeded', { requestId, key: authKey });
        return this.createRateLimitResponse(rateLimitInfo);
      }

      // Apply request hooks
      let finalRequest = llmRequest;
      if (this.hooks.onRequest) {
        const modelConfig = this.getModelConfig(finalRequest);
        finalRequest = await this.hooks.onRequest(finalRequest, modelConfig);
      }

      // Check cache
      const cacheKey = this.generateCacheKey(finalRequest);
      let response: LLMResponse | null = null;
      
      if (this.config.cache?.enabled && this.isCacheable(finalRequest)) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          this.metrics.requests.cached++;
          this.logger.debug('Cache hit', { requestId, cacheKey });
          if (this.hooks.onCacheHit) await this.hooks.onCacheHit(cacheKey, cached);
          
          // Check if stale but revalidatable
          const now = Date.now();
          if (cached.staleExpiresAt && cached.staleExpiresAt > now) {
            // Return stale while revalidating in background
            response = this.createCachedResponse(cached.value);
            this.revalidateCache(cacheKey, finalRequest);
          } else {
            response = this.createCachedResponse(cached.value);
          }
        } else {
          if (this.hooks.onCacheMiss) await this.hooks.onCacheMiss(cacheKey);
        }
      }

      // If not cached, forward to provider
      if (!response) {
        response = await this.forwardRequest(finalRequest, authResult.metadata);
      }

      // Apply response hooks
      const modelConfig = this.getModelConfig(finalRequest);
      if (this.hooks.onResponse) {
        response = await this.hooks.onResponse(response, modelConfig);
      }

      // Cache response
      if (this.config.cache?.enabled && this.isCacheable(finalRequest) && response.ok) {
        await this.cache.set(cacheKey, {
          value: this.serializeResponse(response),
          expiresAt: Date.now() + (this.config.cache.ttl || 300000),
          staleExpiresAt: Date.now() + (this.config.cache.ttl || 300000) + (this.config.cache.staleWhileRevalidate || 60000),
          createdAt: Date.now(),
          hits: 0,
        });
      }

      // Update metrics
      const latency = Date.now() - startTime;
      this.updateMetrics(response, latency, finalRequest);

      // Convert to Response
      return this.toResponse(response);

    } catch (error) {
      this.logger.error('Request handling error', { requestId, error: error.message });
      this.metrics.requests.failed++;
      if (this.hooks.onError) await this.hooks.onError(error as Error, {} as LLMRequest, {} as ModelConfig);
      return this.createErrorResponse(500, 'Internal server error');
    }
  }

  /**
   * Forward request to upstream provider
   */
  private async forwardRequest(
    request: LLMRequest, 
    metadata?: Record<string, any>
  ): Promise<LLMResponse> {
    const modelConfig = this.getModelConfig(request);
    const url = this.buildUpstreamUrl(modelConfig, request.path);
    
    const headers = this.buildUpstreamHeaders(modelConfig, request.headers);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout?.request || 60000);

    let retries = 0;
    const maxRetries = this.config.retry?.maxRetries || 3;
    
    while (true) {
      try {
        const response = await this.fetchImpl(url, {
          method: request.method,
          headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const responseBody = await this.parseResponseBody(response);
        
        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
          ok: response.ok,
        };
      } catch (error) {
        clearTimeout(timeout);
        
        if (retries >= maxRetries || !this.isRetryable(error, request)) {
          throw error;
        }
        
        retries++;
        const delay = this.calculateRetryDelay(retries);
        this.logger.warn('Retrying request', { 
          attempt: retries, 
          maxRetries, 
          delay,
          error: error.message 
        });
        await this.sleep(delay);
      }
    }
  }

  /**
   * Build upstream URL
   */
  private buildUpstreamUrl(modelConfig: ModelConfig, path: string): string {
    const baseUrl = modelConfig.baseUrl || this.getDefaultBaseUrl(modelConfig.provider);
    const url = new URL(path, baseUrl);
    return url.toString();
  }

  /**
   * Get default base URL for provider
   */
  private getDefaultBaseUrl(provider: LLMProvider): string {
    const urls: Record<LLMProvider, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta',
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      cerebras: 'https://api.cerebras.ai/v1',
      cohere: 'https://api.cohere.ai/v1',
      mistral: 'https://api.mistral.ai/v1',
      ollama: 'http://localhost:11434/v1',
      'azure-openai': 'https://{resource}.openai.azure.com',
      'vertex-ai': 'https://{location}-aiplatform.googleapis.com/v1',
      custom: '',
    };
    return urls[provider] || '';
  }

  /**
   * Build upstream headers
   */
  private buildUpstreamHeaders(modelConfig: ModelConfig, requestHeaders: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authorization
    if (modelConfig.apiKey) {
      if (modelConfig.provider === 'anthropic') {
        headers['x-api-key'] = modelConfig.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (modelConfig.provider === 'azure-openai') {
        headers['api-key'] = modelConfig.apiKey;
      } else {
        headers['Authorization'] = `Bearer ${modelConfig.apiKey}`;
      }
    }

    // Add organization header for OpenAI
    if (modelConfig.organization && modelConfig.provider === 'openai') {
      headers['OpenAI-Organization'] = modelConfig.organization;
    }

    // Add custom headers
    if (modelConfig.headers) {
      Object.assign(headers, modelConfig.headers);
    }

    // Pass through relevant request headers
    const passThroughHeaders = ['user-agent', 'accept', 'accept-encoding'];
    for (const h of passThroughHeaders) {
      if (requestHeaders[h]) {
        headers[h] = requestHeaders[h];
      }
    }

    return headers;
  }

  /**
   * Parse request body
   */
  private async parseRequest(request: Request): Promise<LLMRequest> {
    const contentType = request.headers.get('content-type') || '';
    let body: any = undefined;
    
    if (contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }

    return {
      method: request.method as any,
      path: new URL(request.url).pathname,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    };
  }

  /**
   * Parse response body
   */
  private async parseResponseBody(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      try {
        return await response.json();
      } catch {
        return await response.text();
      }
    }
    
    return await response.text();
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(request: LLMRequest): string {
    const relevantBody = { ...request.body };
    // Remove non-deterministic fields
    delete relevantBody.stream;
    delete relevantBody.user;
    
    const keyParts = [
      request.method,
      request.path,
      JSON.stringify(relevantBody),
    ];
    
    // Simple hash
    let hash = 0;
    const str = keyParts.join('|');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    
    return `llm:${Math.abs(hash).toString(36)}`;
  }

  /**
   * Check if request is cacheable
   */
  private isCacheable(request: LLMRequest): boolean {
    // Only cache GET and non-streaming POST requests
    if (request.method !== 'GET' && request.method !== 'POST') return false;
    if (request.body?.stream === true) return false;
    // Don't cache requests with tools (may have side effects)
    if (request.body?.tools?.length) return false;
    return true;
  }

  /**
   * Create cached response
   */
  private createCachedResponse(cachedValue: any): LLMResponse {
    return {
      status: cachedValue.status,
      statusText: cachedValue.statusText,
      headers: { ...cachedValue.headers, 'x-cache': 'HIT' },
      body: cachedValue.body,
      ok: cachedValue.ok,
    };
  }

  /**
   * Serialize response for caching
   */
  private serializeResponse(response: LLMResponse): any {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: response.body,
      ok: response.ok,
    };
  }

  /**
   * Revalidate cache in background
   */
  private async revalidateCache(cacheKey: string, request: LLMRequest) {
    try {
      const response = await this.forwardRequest(request, {});
      if (response.ok) {
        await this.cache.set(cacheKey, {
          value: this.serializeResponse(response),
          expiresAt: Date.now() + (this.config.cache?.ttl || 300000),
          staleExpiresAt: Date.now() + (this.config.cache?.ttl || 300000) + (this.config.cache?.staleWhileRevalidate || 60000),
          createdAt: Date.now(),
          hits: 0,
        });
      }
    } catch (error) {
      this.logger.debug('Cache revalidation failed', { cacheKey, error: error.message });
    }
  }

  /**
   * Get model config for request
   */
  private getModelConfig(request: LLMRequest): ModelConfig {
    const modelName = request.body?.model || this.config.defaultModel || 'gpt-3.5-turbo';
    return this.config.models[modelName] || {
      provider: 'openai',
      model: modelName,
    };
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(error: any, request: LLMRequest): boolean {
    const retryConfig = this.config.retry!;
    if (!retryConfig.enabled) return false;
    
    // Check if it's a network error
    if (error.name === 'AbortError' || error.name === 'TypeError') return true;
    
    // Check status code if available
    if (error.status && retryConfig.retryableStatusCodes?.includes(error.status)) return true;
    
    // Check error message
    if (retryConfig.retryableErrors) {
      const msg = error.message?.toLowerCase() || '';
      return retryConfig.retryableErrors.some(e => msg.includes(e.toLowerCase()));
    }
    
    return false;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number): number {
    const config = this.config.retry!;
    const baseDelay = config.retryDelay || 1000;
    const maxDelay = config.retryDelayMax || 10000;
    
    let delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    
    if (config.retryJitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.floor(delay);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update metrics
   */
  private updateMetrics(response: LLMResponse, latency: number, request: LLMRequest) {
    this.metrics.requests.total++;
    
    if (response.ok) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
      const errorKey = `status_${response.status}`;
      this.metrics.errors[errorKey] = (this.metrics.errors[errorKey] || 0) + 1;
    }
    
    // Update latency percentiles (simplified)
    const latencies = [this.metrics.latency.p50, this.metrics.latency.p95, this.metrics.latency.p99, latency].sort((a, b) => a - b);
    this.metrics.latency.p50 = latencies[1];
    this.metrics.latency.p95 = latencies[2];
    this.metrics.latency.p99 = latencies[3];
    
    // Track tokens
    if (response.body?.usage) {
      this.metrics.tokens.prompt += response.body.usage.prompt_tokens || 0;
      this.metrics.tokens.completion += response.body.usage.completion_tokens || 0;
      this.metrics.tokens.total += response.body.usage.total_tokens || 0;
    }
  }

  /**
   * Convert LLMResponse to Response
   */
  private toResponse(llmResponse: LLMResponse): Response {
    const headers = new Headers(llmResponse.headers);
    
    // Ensure content-type
    if (!headers.has('content-type') && typeof llmResponse.body === 'object') {
      headers.set('content-type', 'application/json');
    }
    
    // Add CORS headers
    if (this.config.cors?.enabled) {
      const corsConfig = this.config.cors;
      headers.set('access-control-allow-origin', corsConfig.origin === '*' ? '*' : corsConfig.origin || '*');
      headers.set('access-control-allow-methods', corsConfig.methods?.join(', ') || 'GET, POST, OPTIONS');
      headers.set('access-control-allow-headers', corsConfig.allowedHeaders?.join(', ') || 'content-type, authorization');
      if (corsConfig.credentials) {
        headers.set('access-control-allow-credentials', 'true');
      }
    }
    
    // Add rate limit headers
    headers.set('x-ratelimit-limit', '100');
    headers.set('x-ratelimit-remaining', '99');
    
    const body = typeof llmResponse.body === 'string' 
      ? llmResponse.body 
      : JSON.stringify(llmResponse.body);
    
    return new Response(body, {
      status: llmResponse.status,
      statusText: llmResponse.statusText,
      headers,
    });
  }

  /**
   * Handle CORS preflight
   */
  private handleCORS(request: Request): Response {
    const headers = new Headers();
    const corsConfig = this.config.cors!;
    
    headers.set('access-control-allow-origin', corsConfig.origin === '*' ? '*' : corsConfig.origin || '*');
    headers.set('access-control-allow-methods', corsConfig.methods?.join(', ') || 'GET, POST, OPTIONS');
    headers.set('access-control-allow-headers', corsConfig.allowedHeaders?.join(', ') || 'content-type, authorization');
    headers.set('access-control-max-age', String(corsConfig.maxAge || 86400));
    
    if (corsConfig.credentials) {
      headers.set('access-control-allow-credentials', 'true');
    }
    
    return new Response(null, { status: 204, headers });
  }

  /**
   * Create error response
   */
  private createErrorResponse(status: number, message: string): Response {
    const body = JSON.stringify({
      error: {
        message,
        type: status === 401 ? 'authentication_error' : 'internal_error',
        code: status,
      },
    });
    
    return new Response(body, {
      status,
      headers: {
        'content-type': 'application/json',
        ...(this.config.cors?.enabled ? { 'access-control-allow-origin': '*' } : {}),
      },
    });
  }

  /**
   * Create rate limit response
   */
  private createRateLimitResponse(info: RateLimitInfo): Response {
    const body = JSON.stringify({
      error: {
        message: 'Rate limit exceeded',
        type: 'rate_limit_error',
        code: 429,
      },
    });
    
    return new Response(body, {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil((info.retryAfter || 60000) / 1000)),
        'x-ratelimit-limit': String(info.total),
        'x-ratelimit-remaining': String(info.remaining),
        'x-ratelimit-reset': String(Math.ceil(info.resetAt / 1000)),
        ...(this.config.cors?.enabled ? { 'access-control-allow-origin': '*' } : {}),
      },
    });
  }

  // Public API methods

  /**
   * Get health status
   */
  async getHealth(): Promise<HealthCheckResponse> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      uptime: Date.now() - this.startTime,
      checks: {
        cache: this.config.cache?.enabled ? 'ok' : 'down',
        rateLimit: this.config.rateLimit?.enabled ? 'ok' : 'down',
        upstream: 'ok',
      },
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = this.initMetrics();
  }

  /**
   * Add hook
   */
  addHook<K extends keyof ProxyHooks>(name: K, hook: ProxyHooks[K]) {
    this.hooks[name] = hook;
  }

  /**
   * Clear cache
   */
  async clearCache() {
    await this.cache.clear();
    this.logger.info('Cache cleared');
  }

  /**
   * Reset rate limit for key
   */
  async resetRateLimit(key: string) {
    await this.rateLimiter.reset(key);
    this.logger.info('Rate limit reset', { key });
  }
}

/**
 * Create proxy instance
 */
export function createProxy(options: ProxyOptions): LLMProxy {
  return new LLMProxy(options);
}

/**
 * API Key Auth Implementation
 */
class APIKeyAuthImpl implements AuthStrategy {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async authenticate(request: LLMRequest): Promise<AuthResult> {
    const apiKey = request.headers[this.config.apiKeyHeader.toLowerCase()];
    
    if (!apiKey) {
      return { success: false, error: 'API key required' };
    }
    
    if (this.config.apiKeys && this.config.apiKeys.length > 0) {
      if (!this.config.apiKeys.includes(apiKey)) {
        return { success: false, error: 'Invalid API key' };
      }
    }
    
    return { success: true, key: apiKey };
  }

  async getKey(request: LLMRequest): Promise<string | null> {
    return request.headers[this.config.apiKeyHeader.toLowerCase()] || 'anonymous';
  }
}

/**
 * Bearer Token Auth Implementation
 */
class BearerTokenAuthImpl implements AuthStrategy {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async authenticate(request: LLMRequest): Promise<AuthResult> {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'Bearer token required' };
    }
    
    const token = authHeader.slice(7);
    
    if (this.config.validTokens && this.config.validTokens.length > 0) {
      if (!this.config.validTokens.includes(token)) {
        return { success: false, error: 'Invalid token' };
      }
    }
    
    return { success: true, key: token };
  }

  async getKey(request: LLMRequest): Promise<string | null> {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return 'anonymous';
  }
}

// Export default config for testing
export { DEFAULT_CONFIG };