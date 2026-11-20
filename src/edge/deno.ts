/**
 * Deno Deploy Adapter
 * 
 * Handles Deno Deploy request/response patterns.
 */

import { LLMProxy, createProxy } from '../core/proxy';
import { DenoContext, ProxyOptions, ModelConfig } from '../types';

/**
 * Create a Deno Deploy fetch handler
 */
export function createDenoHandler(options: ProxyOptions) {
  const proxy = createProxy({
    ...options,
    runtime: 'deno',
  });

  return {
    /**
     * Main fetch handler for Deno Deploy
     */
    async fetch(request: Request, env: DenoContext['env'], ctx: DenoContext): Promise<Response> {
      // Deno Deploy environments may have environment variables in `env`
      const enhancedOptions = enhanceConfigWithEnv(options, env);
      const enhancedProxy = createProxy({ ...options, ...enhancedOptions, runtime: 'deno' });

      try {
        const response = await enhancedProxy.handle(request);
        return response;
      } catch (error) {
        console.error('Deno handler error:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
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
 * Enhance proxy config with Deno environment variables
 */
function enhanceConfigWithEnv(options: ProxyOptions, env: DenoContext['env']): Partial<ProxyOptions> {
  // Similar to Cloudflare but simplified for Deno
  const models: Record<string, ModelConfig> = {};

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('LLM_') && key.endsWith('_PROVIDER')) {
      const modelName = key.slice(4, -9).toLowerCase().replace(/_/g, '-');
      models[modelName] = {
        provider: value as any,
        model: Deno.env.get(`LLM_${modelName.toUpperCase()}_MODEL`) || modelName,
        apiKey: Deno.env.get(`LLM_${modelName.toUpperCase()}_API_KEY`) as string,
        baseUrl: Deno.env.get(`LLM_${modelName.toUpperCase()}_BASE_URL`),
      };
    }
  }

  return {
    config: {
      ...options.config,
      models: { ...options.config?.models, ...models },
    },
  };
}

/**
 * Example deploy command (as reference)
 */
/*
# deno deploy deploy

# Example environment variable setup:
export LLM_openai_PROVIDER=openai
export LLM_openai_MODEL=gpt-3.5-turbo
export LLM_openai_API_KEY=<your-key>
export CACHE_ENABLED=true
export RATE_LIMIT_ENABLED=true

# Deploy with:
deno deploy --allow-read --allow-env --allow-functions
*/
export { LLMProxy, createProxy } from '../core/proxy';
export type { DenoContext, ModelConfig, ProxyOptions } from '../types';