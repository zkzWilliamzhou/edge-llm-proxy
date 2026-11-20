/**
 * Cloudflare Workers Adapter
 * 
 * Handles Cloudflare Workers specific request/response patterns.
 */

import { LLMProxy, createProxy } from '../core/proxy';
import { CloudflareContext, ProxyOptions, ModelConfig } from '../types';

/**
 * Create a Cloudflare Workers fetch handler
 */
export function createCloudflareHandler(options: ProxyOptions) {
  const proxy = createProxy({
    ...options,
    runtime: 'cloudflare',
  });

  return {
    /**
     * Main fetch handler for Cloudflare Workers
     */
    async fetch(request: Request, env: CloudflareContext['env'], ctx: CloudflareContext): Promise<Response> {
      // Inject environment variables into proxy config
      const enhancedOptions = enhanceConfigWithEnv(options, env);
      const enhancedProxy = createProxy({ ...options, ...enhancedOptions, runtime: 'cloudflare' });

      try {
        const response = await enhancedProxy.handle(request);
        
        // Handle waitUntil for background tasks
        if (ctx.waitUntil) {
          // Background cache revalidation is handled internally
        }
        
        return response;
      } catch (error) {
        console.error('Cloudflare handler error:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
    },

    /**
     * Scheduled handler for cron triggers
     */
    async scheduled(event: ScheduledEvent, env: CloudflareContext['env'], ctx: CloudflareContext): Promise<void> {
      // Could be used for cache warming, metrics reporting, etc.
      console.log('Scheduled task triggered:', event.cron);
    },

    /**
     * Get proxy instance for direct access
     */
    getProxy(): LLMProxy {
      return proxy;
    },
  };
}

/**
 * Enhance proxy config with Cloudflare environment variables
 */
function enhanceConfigWithEnv(options: ProxyOptions, env: CloudflareContext['env']): Partial<ProxyOptions> {
  const models: Record<string, ModelConfig> = {};
  
  // Parse model configurations from environment
  // Format: MODEL_<NAME>_PROVIDER, MODEL_<NAME>_API_KEY, MODEL_<NAME>_BASE_URL, etc.
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('MODEL_') && key.endsWith('_PROVIDER')) {
      const modelName = key.slice(6, -8).toLowerCase().replace(/_/g, '-');
      const provider = value as any;
      
      models[modelName] = {
        provider,
        model: (env[`MODEL_${modelName.toUpperCase().replace(/-/g, '_')}_MODEL`] as string) || modelName,
        apiKey: env[`MODEL_${modelName.toUpperCase().replace(/-/g, '_')}_API_KEY`] as string,
        baseUrl: env[`MODEL_${modelName.toUpperCase().replace(/-/g, '_')}_BASE_URL`] as string,
        organization: env[`MODEL_${modelName.toUpperCase().replace(/-/g, '_')}_ORG`] as string,
      };
    }
  }

  return {
    config: {
      ...options.config,
      models: { ...options.config?.models, ...models },
      // Cloudflare-specific defaults
      cache: {
        ...options.config?.cache,
        adapter: options.config?.cache?.adapter || 'memory', // Upstash Redis can be configured separately
      },
    },
  };
}

/**
 * Cloudflare-specific model config helpers
 */
export const cloudflareModels = {
  /**
   * Create model config from Cloudflare secrets
   */
  fromSecrets(secrets: Record<string, string>, prefix = 'LLM'): Record<string, ModelConfig> {
    const models: Record<string, ModelConfig> = {};
    
    for (const [key, value] of Object.entries(secrets)) {
      if (key.startsWith(`${prefix}_`) && key.endsWith('_API_KEY')) {
        const modelId = key.slice(prefix.length + 1, -8).toLowerCase();
        const providerKey = `${prefix}_${modelId.toUpperCase()}_PROVIDER`;
        const provider = secrets[providerKey] as any || 'openai';
        
        models[modelId] = {
          provider,
          model: (secrets[`${prefix}_${modelId.toUpperCase()}_MODEL`] as string) || modelId,
          apiKey: value,
          baseUrl: secrets[`${prefix}_${modelId.toUpperCase()}_BASE_URL`],
          organization: secrets[`${prefix}_${modelId.toUpperCase()}_ORG`],
        };
      }
    }
    
    return models;
  },

  /**
   * Predefined model configurations for common providers
   */
  presets: {
    openai: (apiKey: string, model = 'gpt-3.5-turbo'): ModelConfig => ({
      provider: 'openai',
      model,
      apiKey,
    }),
    anthropic: (apiKey: string, model = 'claude-3-haiku-20240307'): ModelConfig => ({
      provider: 'anthropic',
      model,
      apiKey,
    }),
    gemini: (apiKey: string, model = 'gemini-pro'): ModelConfig => ({
      provider: 'gemini',
      model,
      apiKey,
    }),
    groq: (apiKey: string, model = 'llama3-8b-8192'): ModelConfig => ({
      provider: 'groq',
      model,
      apiKey,
    }),
    deepseek: (apiKey: string, model = 'deepseek-chat'): ModelConfig => ({
      provider: 'deepseek',
      model,
      apiKey,
    }),
  },
};

/**
 * Example wrangler.toml configuration (as reference)
 */
/*
# wrangler.toml example:

name = "edge-llm-proxy"
main = "src/edge/cloudflare.ts"
compatibility_date = "2024-01-01"

[vars]
DEFAULT_MODEL = "gpt-3.5-turbo"
CACHE_ENABLED = "true"
RATE_LIMIT_ENABLED = "true"

# Model configurations
MODEL_GPT35_PROVIDER = "openai"
MODEL_GPT35_MODEL = "gpt-3.5-turbo"
MODEL_GPT35_API_KEY = ""  # Set in secrets
MODEL_GPT35_BASE_URL = "https://api.openai.com/v1"

MODEL_CLAUDE_PROVIDER = "anthropic"
MODEL_CLAUDE_MODEL = "claude-3-haiku-20240307"
MODEL_CLAUDE_API_KEY = ""  # Set in secrets

# Upstash Redis (optional)
UPSTASH_REDIS_URL = ""  # Set in secrets
UPSTASH_REDIS_TOKEN = ""  # Set in secrets

[triggers]
crons = ["0 * * * *"]  # Hourly cache warming
*/

export { LLMProxy, createProxy } from '../core/proxy';
export type { CloudflareContext, ModelConfig, ProxyOptions } from '../types';