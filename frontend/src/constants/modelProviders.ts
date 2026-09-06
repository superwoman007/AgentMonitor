export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'bearer' | 'api-key';
  models: Array<{ id: string; name: string }>;
  docsUrl: string;
}

export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      { id: 'o3-mini', name: 'o3-mini' },
      { id: 'o1', name: 'o1' },
    ],
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'bearer',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    ],
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    authType: 'bearer',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
      { id: 'deepseek-chat', name: 'DeepSeek-Chat (legacy)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-Reasoner (legacy)' },
    ],
    docsUrl: 'https://api-docs.deepseek.com',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    authType: 'bearer',
    models: [
      { id: 'kimi-k2.6', name: 'Kimi K2.6' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'kimi-k2', name: 'Kimi K2' },
      { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K' },
      { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K' },
    ],
    docsUrl: 'https://platform.moonshot.ai/docs',
  },
  {
    id: 'glm',
    name: 'GLM (智谱AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authType: 'bearer',
    models: [
      { id: 'glm-4.7', name: 'GLM-4.7' },
      { id: 'glm-4.6v', name: 'GLM-4.6V' },
      { id: 'glm-4.5', name: 'GLM-4.5' },
      { id: 'glm-4.5-air', name: 'GLM-4.5-Air' },
      { id: 'glm-4-plus', name: 'GLM-4-Plus' },
      { id: 'glm-4-flash', name: 'GLM-4-Flash' },
    ],
    docsUrl: 'https://open.bigmodel.cn/dev/api',
  },
  {
    id: 'doubao',
    name: '豆包 (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    authType: 'bearer',
    models: [
      { id: 'doubao-seed-2-0-lite-260215', name: 'Doubao Seed 2.0 Lite' },
      { id: 'doubao-pro-32k', name: 'Doubao Pro 32K' },
      { id: 'doubao-lite-32k', name: 'Doubao Lite 32K' },
      { id: 'doubao-1.5-pro', name: 'Doubao-1.5-Pro' },
      { id: 'doubao-1.5-vision-pro', name: 'Doubao-1.5-Vision-Pro' },
    ],
    docsUrl: 'https://www.volcengine.com/docs/82379',
  },
  {
    id: 'mimo',
    name: 'MiMo (小米)',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    authType: 'api-key',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
      { id: 'mimo-v2-pro', name: 'MiMo V2 Pro' },
      { id: 'mimo-v2-flash', name: 'MiMo V2 Flash' },
    ],
    docsUrl: 'https://platform.xiaomimimo.com',
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    authType: 'bearer',
    models: [],
    docsUrl: '',
  },
];

export function getProviderById(id: string): ModelProvider | undefined {
  return MODEL_PROVIDERS.find((p) => p.id === id);
}
