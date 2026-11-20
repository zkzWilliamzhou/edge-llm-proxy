/**
 * Type Definitions for Edge LLM Proxy
 * 
 * Shared types used across all modules
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = 
  | 'openai' 
  | 'anthropic' 
  | 'gemini' 
  | 'deepseek' 
  | 'groq' 
  | 'cerebras' 
  | 'cohere' 
  | 'mistral' 
  | 'ollama' 
  | 'azure-openai' 
  | 'vertex-ai'
  | 'custom';

/**
 * HTTP method types
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * Standard OpenAI-compatible chat message
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  function_call?: FunctionCall;
}

/**
 * Tool call structure
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: FunctionCall;
}

/**
 * Function call structure
 */
export interface FunctionCall {
  name: string;
  arguments: string;
}

/**
 * Chat completion request (OpenAI-compatible)
 */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  max_completion_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' | 'json_schema'; json_schema?: any };
  seed?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  parallel_tool_calls?: boolean;
  [key: string]: any;
}

/**
 * Tool definition
 */
export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, any>;
    strict?: boolean;
  };
}

/**
 * Chat completion response (OpenAI-compatible)
 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion' | 'chat.completion.chunk';
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: ChatChoice[];
  usage?: Usage;
  [key: string]: any;
}

/**
 * Chat choice
 */
export interface ChatChoice {
  index: number;
  message?: ChatMessage;
  delta?: Partial<ChatMessage>;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
  logprobs?: LogProbs | null;
}

/**
 * Log probabilities
 */
export interface LogProbs {
  content: TokenLogProb[];
}

/**
 * Token log probability
 */
export interface TokenLogProb {
  token: string;
  logprob: number;
  bytes: number[];
  top_logprobs: TopLogProb[];
}

/**
 * Top log probability
 */
export interface TopLogProb {
  token: string;
  logprob: number;
  bytes: number[];
}

/**
 * Token usage
 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    audio_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
  };
}

/**
 * Embedding request
 */
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  object: 'list';
  data: EmbeddingData[];
  model: string;
  usage: Usage;
}

/**
 * Embedding data
 */
export interface EmbeddingData {
  object: 'embedding';
  index: number;
  embedding: number[];
}

/**
 * Models list response
 */
export interface ModelsResponse {
  object: 'list';
  data: ModelInfo[];
}

/**
 * Model info
 */
export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  permission?: ModelPermission[];
  root?: string;
  parent?: string;
}

/**
 * Model permission
 */
export interface ModelPermission {
  id: string;
  object: 'model_permission';
  created: number;
  allow_create_engine: boolean;
  allow_sampling: boolean;
  allow_logprobs: boolean;
  allow_search_indices: boolean;
  allow_view: boolean;
  allow_fine_tuning: boolean;
  organization: string;
  group: string | null;
  is_blocking: boolean;
}

/**
 * Generic LLM request (can be chat, embedding, etc.)
 */
export interface LLMRequest {
  method: HTTPMethod;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
}

/**
 * Generic LLM response
 */
export interface LLMResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  ok: boolean;
}

/**
 * Model configuration for a provider
 */
export interface ModelConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  headers?: Record<string, string>;
  // Provider-specific options
  azure?: {
    deployment?: string;
    apiVersion?: string;
  };
  vertex?: {
    projectId?: string;
    location?: string;
  };
  ollama?: {
    baseUrl?: string;
  };
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  // Upstream model configurations
  models: Record<string, ModelConfig>;
  
  // Default model to use if not specified
  defaultModel?: string;
  
  // Cache configuration
  cache?: CacheConfig;
  
  // Rate limiting configuration
  rateLimit?: RateLimitConfig;
  
  // Authentication configuration
  auth?: AuthConfig;
  
  // Request/response transformation
  transform?: TransformConfig;
  
  // Logging
  logging?: LoggingConfig;
  
  // CORS
  cors?: CorsConfig;
  
  // Timeout settings
  timeout?: TimeoutConfig;
  
  // Retry settings
  retry?: RetryConfig;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  adapter?: 'memory' | 'upstash-redis' | 'custom';
  // Memory cache options
  maxSize?: number;           // Max entries
  ttl?: number;               // Time to live in ms
  staleWhileRevalidate?: number; // Stale-while-revalidate window in ms
  // Upstash Redis options
  upstashUrl?: string;
  upstashToken?: string;
  // Custom adapter
  customAdapter?: CacheAdapter;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  enabled: boolean;
  algorithm?: 'token-bucket' | 'sliding-window' | 'fixed-window';
  // Token bucket
  tokensPerInterval?: number;
  interval?: number; // ms
  // Sliding window
  windowMs?: number;
  maxRequests?: number;
  // Per-key limits (can be overridden by auth)
  keyPrefix?: string;
  // Custom limiter
  customLimiter?: RateLimiter;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  enabled: boolean;
  strategy?: 'api-key' | 'bearer-token' | 'custom';
  // API key options
  apiKeys?: string[];           // Valid API keys
  apiKeyHeader?: string;        // Header name (default: 'x-api-key')
  // Bearer token options
  validTokens?: string[];       // Valid bearer tokens
  // Custom auth
  customAuth?: AuthStrategy;
  // Skip auth for certain paths
  skipPaths?: string[];
}

/**
 * Transform configuration
 */
export interface TransformConfig {
  // Request transforms
  request?: RequestTransform[];
  // Response transforms
  response?: ResponseTransform[];
}

/**
 * Request transform
 */
export interface RequestTransform {
  match?: {
    path?: string | RegExp;
    method?: HTTPMethod;
    provider?: LLMProvider;
  };
  transform: (request: LLMRequest, config: ModelConfig) => LLMRequest | Promise<LLMRequest>;
}

/**
 * Response transform
 */
export interface ResponseTransform {
  match?: {
    path?: string | RegExp;
    method?: HTTPMethod;
    provider?: LLMProvider;
    statusCode?: number;
  };
  transform: (response: LLMResponse, config: ModelConfig) => LLMResponse | Promise<LLMResponse>;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  enabled: boolean;
  level?: 'debug' | 'info' | 'warn' | 'error';
  includeRequestBody?: boolean;
  includeResponseBody?: boolean;
  maskSensitiveHeaders?: string[];
  customLogger?: Logger;
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  enabled: boolean;
  origin?: string | string[] | '*';
  methods?: HTTPMethod[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  connect?: number;     // Connection timeout (ms)
  request?: number;     // Request timeout (ms)
  response?: number;    // Response timeout (ms)
  idle?: number;        // Idle timeout (ms)
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  enabled: boolean;
  maxRetries?: number;
  retryDelay?: number;           // Base delay (ms)
  retryDelayMax?: number;        // Max delay (ms)
  retryJitter?: boolean;         // Add jitter
  retryableStatusCodes?: number[];
  retryableErrors?: string[];    // Error codes/messages
}

/**
 * Cache adapter interface
 */
export interface CacheAdapter {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Cache entry
 */
export interface CacheEntry {
  value: any;
  expiresAt: number;
  staleExpiresAt?: number;
  createdAt: number;
  hits: number;
}

/**
 * Rate limiter interface
 */
export interface RateLimiter {
  checkLimit(key: string): Promise<RateLimitInfo>;
  increment(key: string): Promise<RateLimitInfo>;
  reset(key: string): Promise<void>;
  getLimit(key: string): Promise<RateLimitInfo | null>;
}

/**
 * Rate limit info
 */
export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  total: number;
  retryAfter?: number;
}

/**
 * Auth strategy interface
 */
export interface AuthStrategy {
  authenticate(request: LLMRequest): Promise<AuthResult>;
  getKey(request: LLMRequest): string | null;
}

/**
 * Auth result
 */
export interface AuthResult {
  success: boolean;
  key?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, meta?: Record<string, any>): void;
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
}

/**
 * Proxy options for createProxy
 */
export interface ProxyOptions {
  config: ProxyConfig;
  // Runtime-specific options
  runtime?: 'cloudflare' | 'deno' | 'vercel' | 'node' | 'bun';
  // Custom fetch implementation
  fetch?: typeof fetch;
}

/**
 * Edge runtime context (common)
 */
export interface EdgeContext {
  request: Request;
  env?: Record<string, string>;
  waitUntil?: (promise: Promise<any>) => void;
  passThroughOnException?: () => void;
}

/**
 * Cloudflare-specific context
 */
export interface CloudflareContext extends EdgeContext {
  env: {
    [key: string]: string | any;
  };
  waitUntil: (promise: Promise<any>) => void;
}

/**
 * Deno-specific context
 */
export interface DenoContext extends EdgeContext {
  env: Record<string, string>;
}

/**
 * Vercel-specific context
 */
export interface VercelContext extends EdgeContext {
  env: Record<string, string>;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    cache: 'ok' | 'degraded' | 'down';
    rateLimit: 'ok' | 'degraded' | 'down';
    upstream: 'ok' | 'degraded' | 'down';
  };
}

/**
 * Metrics
 */
export interface Metrics {
  requests: {
    total: number;
    successful: number;
    failed: number;
    cached: number;
    rateLimited: number;
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  errors: Record<string, number>;
}

/**
 * Proxy event hooks
 */
export interface ProxyHooks {
  onRequest?: (request: LLMRequest, config: ModelConfig) => LLMRequest | Promise<LLMRequest>;
  onResponse?: (response: LLMResponse, config: ModelConfig) => LLMResponse | Promise<LLMResponse>;
  onError?: (error: Error, request: LLMRequest, config: ModelConfig) => void | Promise<void>;
  onCacheHit?: (key: string, entry: CacheEntry) => void | Promise<void>;
  onCacheMiss?: (key: string) => void | Promise<void>;
  onRateLimited?: (key: string, info: RateLimitInfo) => void | Promise<void>;
}