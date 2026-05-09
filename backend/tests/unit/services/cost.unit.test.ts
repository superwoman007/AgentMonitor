import {
  getModelPricing,
  extractModelFromMetadata,
  extractTokensFromMetadata,
  parseJsonIfString,
  MODEL_PRICING,
} from '../../../src/services/cost.js';

describe('Cost Service 纯函数', () => {
  describe('parseJsonIfString', () => {
    it('应该解析有效 JSON 字符串', () => {
      expect(parseJsonIfString('{"a":1}')).toEqual({ a: 1 });
      expect(parseJsonIfString('[1,2,3]')).toEqual([1, 2, 3]);
      expect(parseJsonIfString('"hello"')).toBe('hello');
    });

    it('应该原样返回非字符串值', () => {
      expect(parseJsonIfString(null)).toBe(null);
      expect(parseJsonIfString(undefined)).toBe(undefined);
      expect(parseJsonIfString(42)).toBe(42);
      expect(parseJsonIfString({ a: 1 })).toEqual({ a: 1 });
    });

    it('应该对无效 JSON 返回原字符串', () => {
      expect(parseJsonIfString('not json')).toBe('not json');
      expect(parseJsonIfString('hello world')).toBe('hello world');
    });

    it('应该对空字符串返回原值', () => {
      expect(parseJsonIfString('')).toBe('');
      expect(parseJsonIfString('   ')).toBe('   ');
    });

    it('应该对不以 { [ " 开头的字符串返回原值', () => {
      expect(parseJsonIfString('abc')).toBe('abc');
      expect(parseJsonIfString('123')).toBe('123');
    });
  });

  describe('getModelPricing', () => {
    it('应该返回已知模型的定价', () => {
      // 精确匹配的模型名（不会被更长的 key 抢先匹配）
      expect(getModelPricing('gpt-3.5-turbo')).toEqual(MODEL_PRICING['gpt-3.5-turbo']);
      expect(getModelPricing('gpt-4o-mini')).toEqual(MODEL_PRICING['gpt-4o-mini']);
      expect(getModelPricing('claude-3-opus')).toEqual(MODEL_PRICING['claude-3-opus']);
      expect(getModelPricing('claude-3-haiku')).toEqual(MODEL_PRICING['claude-3-haiku']);
    });

    it('应该对未知模型返回默认定价', () => {
      expect(getModelPricing('unknown-model')).toEqual(MODEL_PRICING['default']);
      expect(getModelPricing('llama-70b')).toEqual(MODEL_PRICING['default']);
    });

    it('应该忽略大小写匹配模型', () => {
      expect(getModelPricing('GPT-3.5-TURBO')).toEqual(MODEL_PRICING['gpt-3.5-turbo']);
      expect(getModelPricing('Claude-3-Opus')).toEqual(MODEL_PRICING['claude-3-opus']);
    });

    it('应该匹配包含模型名的字符串', () => {
      expect(getModelPricing('gpt-4-0613')).toEqual(MODEL_PRICING['gpt-4']);
      expect(getModelPricing('gpt-4o-2024-05-13')).toEqual(MODEL_PRICING['gpt-4o']);
    });

    it('应该优先匹配更长的模型名', () => {
      // gpt-4-turbo 应该匹配 gpt-4-turbo 而非 gpt-4
      expect(getModelPricing('gpt-4-turbo')).toEqual(MODEL_PRICING['gpt-4-turbo']);
      expect(getModelPricing('gpt-4o-mini')).toEqual(MODEL_PRICING['gpt-4o-mini']);
    });
  });

  describe('extractModelFromMetadata', () => {
    it('应该从 metadata.model 提取模型名', () => {
      expect(extractModelFromMetadata({ model: 'gpt-4' })).toBe('gpt-4');
    });

    it('应该从 metadata.modelId 提取模型名', () => {
      expect(extractModelFromMetadata({ modelId: 'claude-3-sonnet' })).toBe('claude-3-sonnet');
    });

    it('应该优先使用 model 字段', () => {
      expect(extractModelFromMetadata({ model: 'gpt-4', modelId: 'gpt-3.5' })).toBe('gpt-4');
    });

    it('应该对无模型信息返回 unknown', () => {
      expect(extractModelFromMetadata({})).toBe('unknown');
      expect(extractModelFromMetadata(null)).toBe('unknown');
      expect(extractModelFromMetadata(undefined)).toBe('unknown');
      expect(extractModelFromMetadata('not-object')).toBe('unknown');
    });

    it('应该处理 JSON 字符串格式的 metadata', () => {
      expect(extractModelFromMetadata('{"model":"gpt-4"}')).toBe('gpt-4');
      expect(extractModelFromMetadata('{"modelId":"claude-3-haiku"}')).toBe('claude-3-haiku');
    });
  });

  describe('extractTokensFromMetadata', () => {
    it('应该从 usage.prompt_tokens/completion_tokens 提取', () => {
      const metadata = {
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };
      expect(extractTokensFromMetadata(metadata)).toEqual({ input: 100, output: 50 });
    });

    it('应该从 usage.inputTokens/outputTokens 提取', () => {
      const metadata = {
        usage: { inputTokens: 200, outputTokens: 80 },
      };
      expect(extractTokensFromMetadata(metadata)).toEqual({ input: 200, output: 80 });
    });

    it('应该从 usage.input_tokens/output_tokens 提取', () => {
      const metadata = {
        usage: { input_tokens: 150, output_tokens: 60 },
      };
      expect(extractTokensFromMetadata(metadata)).toEqual({ input: 150, output: 60 });
    });

    it('应该从顶层 prompt_tokens/completion_tokens 提取', () => {
      const metadata = { prompt_tokens: 300, completion_tokens: 120 };
      expect(extractTokensFromMetadata(metadata)).toEqual({ input: 300, output: 120 });
    });

    it('应该对无 token 信息返回 {0, 0}', () => {
      expect(extractTokensFromMetadata({})).toEqual({ input: 0, output: 0 });
      expect(extractTokensFromMetadata(null)).toEqual({ input: 0, output: 0 });
      expect(extractTokensFromMetadata(undefined)).toEqual({ input: 0, output: 0 });
    });

    it('应该处理 JSON 字符串格式的 metadata', () => {
      const metadata = '{"usage":{"prompt_tokens":500,"completion_tokens":200}}';
      expect(extractTokensFromMetadata(metadata)).toEqual({ input: 500, output: 200 });
    });

    it('应该优先使用 usage 内的字段', () => {
      const metadata = {
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        prompt_tokens: 999,
        completion_tokens: 999,
      };
      expect(extractTokensFromMetadata(metadata)).toEqual({ input: 100, output: 50 });
    });
  });
});
