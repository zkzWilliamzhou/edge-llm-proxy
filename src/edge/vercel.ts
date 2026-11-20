/**
 * Vercel Edge Functions Adapter
 * 
 * Handles Vercel Edge Functions request/response patterns.
 */

import { LLMProxy, createProxy } from '../core/proxy';
import { VercelContext, ProxyOptions, ModelConfig } from '../types';

/**
 * Create a Vercel Edge Function handler
 */
export function createVercelHandler(options: ProxyOptions) {
  const proxy = createProxy({
    ...options,
    runtime: 'vercel',
  });

  return {
    /**
     * Main handler for Vercel Edge Functions
     */
    async handler(request: Request): Promise<Response> {
      const enhancedOptions = this.enhanceConfigWithEnv(options);
      const enhancedProxy = createProxy({ ...options, ...enhancedOptions, runtime: 'vercel' });

      try {
        const response = await enhancedProxy.handle(request);
        return response;
      } catch (error) {
        console.error('Vercel handler error:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
    },

    /**
     * Get proxy instance for direct access
     */
    getProxy(): LLMProxy {
      return proxy;
    },

    /**
     * Enhance config with Vercel environment
     */
    enhanceConfigWithEnv: (options: ProxyOptions): Partial<ProxyOptions> => {
      const models: Record<string, ModelConfig> = {};
      
      // Vercel typically uses environment variables
      for (const key of Object.keys(options.env || {})) {
        if (key.startsWith('LLM_') && key.endsWith('_PROVIDER')) {
          const modelName = key.slice(4, -9).toLowerCase().replace(/_/g, '-');
          models[modelName] = {
            provider: options.env![key] as any,
            model: options.env![`LLM_${modelName.toUpperCase()}_MODEL`] as string,
            apiKey: options.env![`LLM_${modelName.toUpperCase()}_API_KEY`] as string,
          };
        }
      }

      return {
        config: {
          ...options.config,
          models: { ...options.config?.models, ...models },
        },
      };
    },
  };
}

/**
 * Example vercel.json configuration (as reference)
 */
/*
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "content-type, authorization" }
      ]
    }
  ],
  "routes": [
    {
      "source": "/api/llm-proxy(.*)",
      "methods": ["GET", "POST", "OPTIONS"],
      "handler": "src/edge/vercel.ts"
    }
  ]
}
*/

export { LLMProxy, createProxy } from '../core/proxy';
export type { VercelContext, ModelConfig, ProxyOptions } from '../types';