import { describe, it, expect } from 'vitest';
import { MODEL_PROVIDERS, getProviderById } from '../../../src/constants/modelProviders';

describe('modelProviders', () => {
  describe('MODEL_PROVIDERS', () => {
    it('应包含所有国内供应商', () => {
      const providerIds = MODEL_PROVIDERS.map(p => p.id);
      expect(providerIds).toContain('deepseek');
      expect(providerIds).toContain('kimi');
      expect(providerIds).toContain('glm');
      expect(providerIds).toContain('doubao');
      expect(providerIds).toContain('mimo');
    });

    it('每个供应商都应有名称和文档链接', () => {
      for (const provider of MODEL_PROVIDERS) {
        expect(provider.name).toBeTruthy();
        expect(provider.baseUrl).toBeDefined();
        expect(provider.models).toBeDefined();
        expect(Array.isArray(provider.models)).toBe(true);
      }
    });

    it('国内供应商应有预设模型', () => {
      const domestic = ['deepseek', 'kimi', 'glm', 'doubao', 'mimo'];
      for (const id of domestic) {
        const p = MODEL_PROVIDERS.find(p => p.id === id);
        expect(p).toBeDefined();
        expect(p!.models.length).toBeGreaterThan(0);
      }
    });

    it('国内供应商 Base URL 应正确', () => {
      expect(getProviderById('deepseek')?.baseUrl).toBe('https://api.deepseek.com');
      expect(getProviderById('kimi')?.baseUrl).toBe('https://api.moonshot.ai/v1');
      expect(getProviderById('glm')?.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
      expect(getProviderById('doubao')?.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
      expect(getProviderById('mimo')?.baseUrl).toBe('https://api.xiaomimimo.com/v1');
    });

    it('MiMo 应使用 api-key 认证方式', () => {
      const mimo = getProviderById('mimo');
      expect(mimo?.authType).toBe('api-key');
    });

    it('其他国内供应商应使用 bearer 认证方式', () => {
      for (const id of ['deepseek', 'kimi', 'glm', 'doubao']) {
        expect(getProviderById(id)?.authType).toBe('bearer');
      }
    });

    it('Custom 供应商模型列表应为空', () => {
      const custom = getProviderById('custom');
      expect(custom?.models.length).toBe(0);
    });
  });

  describe('getProviderById', () => {
    it('应能通过 ID 找到供应商', () => {
      expect(getProviderById('openai')?.name).toBe('OpenAI');
      expect(getProviderById('deepseek')?.name).toBe('DeepSeek');
    });

    it('不存在的 ID 应返回 undefined', () => {
      expect(getProviderById('nonexistent')).toBeUndefined();
    });
  });
});
