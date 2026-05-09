import { describe, it, expect } from 'vitest';
import { sanitizeData } from '../src/middleware/sanitize.js';

describe('sanitizeData', () => {
  describe('敏感字段过滤', () => {
    it('应将 password 替换为 [FILTERED]', () => {
      const result = sanitizeData({ password: 'secret123' }) as Record<string, unknown>;
      expect(result.password).toBe('[FILTERED]');
    });

    it('应将 token 替换为 [FILTERED]', () => {
      const result = sanitizeData({ token: 'bearer_xyz' }) as Record<string, unknown>;
      expect(result.token).toBe('[FILTERED]');
    });

    it('应将 api_key 替换为 [FILTERED]', () => {
      const result = sanitizeData({ api_key: 'ak_12345' }) as Record<string, unknown>;
      expect(result.api_key).toBe('[FILTERED]');
    });

    it('应将 apikey 替换为 [FILTERED]', () => {
      const result = sanitizeData({ apikey: 'ak_12345' }) as Record<string, unknown>;
      expect(result.apikey).toBe('[FILTERED]');
    });

    it('应将 authorization 替换为 [FILTERED]', () => {
      const result = sanitizeData({ authorization: 'Bearer xyz' }) as Record<string, unknown>;
      expect(result.authorization).toBe('[FILTERED]');
    });

    it('应将 secret 替换为 [FILTERED]', () => {
      const result = sanitizeData({ secret: 'shh' }) as Record<string, unknown>;
      expect(result.secret).toBe('[FILTERED]');
    });

    it('应将 cookie 替换为 [FILTERED]', () => {
      const result = sanitizeData({ cookie: 'session=abc' }) as Record<string, unknown>;
      expect(result.cookie).toBe('[FILTERED]');
    });

    it('应将 credit_card 替换为 [FILTERED]', () => {
      const result = sanitizeData({ credit_card: '1234' }) as Record<string, unknown>;
      expect(result.credit_card).toBe('[FILTERED]');
    });

    it('应将 ssn 替换为 [FILTERED]', () => {
      const result = sanitizeData({ ssn: '123-45-6789' }) as Record<string, unknown>;
      expect(result.ssn).toBe('[FILTERED]');
    });

    it('应将 social_security 替换为 [FILTERED]', () => {
      const result = sanitizeData({ social_security: '123-45-6789' }) as Record<string, unknown>;
      expect(result.social_security).toBe('[FILTERED]');
    });

    it('应将 private_key 替换为 [FILTERED]', () => {
      const result = sanitizeData({ private_key: 'pk_xxx' }) as Record<string, unknown>;
      expect(result.private_key).toBe('[FILTERED]');
    });

    it('应支持下划线分隔的复合键名', () => {
      const result = sanitizeData({ user_password: 'secret', db_api_key: 'key' }) as Record<string, unknown>;
      expect(result.user_password).toBe('[FILTERED]');
      expect(result.db_api_key).toBe('[FILTERED]');
    });

    it('应支持中划线分隔的复合键名', () => {
      const result = sanitizeData({ 'auth-token': 't', 'x-api-key': 'k' }) as Record<string, unknown>;
      expect(result['auth-token']).toBe('[FILTERED]');
      expect(result['x-api-key']).toBe('[FILTERED]');
    });

    it('应支持点号分隔的复合键名', () => {
      const result = sanitizeData({ 'auth.token': 't', 'user.secret': 's' }) as Record<string, unknown>;
      expect(result['auth.token']).toBe('[FILTERED]');
      expect(result['user.secret']).toBe('[FILTERED]');
    });

    it('应忽略大小写', () => {
      const result = sanitizeData({ PASSWORD: 'secret', Token: 't', Api_Key: 'k' }) as Record<string, unknown>;
      expect(result.PASSWORD).toBe('[FILTERED]');
      expect(result.Token).toBe('[FILTERED]');
      expect(result.Api_Key).toBe('[FILTERED]');
    });

    it('不应误伤普通字段', () => {
      const result = sanitizeData({ name: 'test', age: 18, active: true }) as Record<string, unknown>;
      expect(result.name).toBe('test');
      expect(result.age).toBe(18);
      expect(result.active).toBe(true);
    });
  });

  describe('邮箱脱敏', () => {
    it('应将邮箱脱敏为 us***@ex***', () => {
      const result = sanitizeData({ email: 'user@example.com' }) as Record<string, unknown>;
      expect(result.email).toBe('us***@ex***');
    });

    it('应处理短本地名和短域名的邮箱', () => {
      const result = sanitizeData({ email: 'ab@x.com' }) as Record<string, unknown>;
      expect(result.email).toBe('ab***@x.***');
    });

    it('应处理包含点号的邮箱', () => {
      const result = sanitizeData({ email: 'first.last@sub.example.com' }) as Record<string, unknown>;
      expect(result.email).toBe('fi***@su***');
    });

    it('应处理纯字符串中的邮箱', () => {
      const result = sanitizeData('Contact user@example.com for help') as string;
      expect(result).toBe('Contact us***@ex*** for help');
    });

    it('应同时处理多个邮箱', () => {
      const result = sanitizeData('a@b.com and c@d.com') as string;
      expect(result).toBe('a***@b.*** and c***@d.***');
    });
  });

  describe('手机号脱敏', () => {
    it('应将中国大陆手机号脱敏为 138****5678 格式', () => {
      const result = sanitizeData({ phone: '13812345678' }) as Record<string, unknown>;
      expect(result.phone).toBe('138****5678');
    });

    it('应处理 1[3-9] 开头的多种号段', () => {
      expect((sanitizeData({ p: '13100000000' }) as Record<string, unknown>).p).toBe('131****0000');
      expect((sanitizeData({ p: '15000000000' }) as Record<string, unknown>).p).toBe('150****0000');
      expect((sanitizeData({ p: '18900000000' }) as Record<string, unknown>).p).toBe('189****0000');
      expect((sanitizeData({ p: '19900000000' }) as Record<string, unknown>).p).toBe('199****0000');
    });

    it('应处理字符串中的手机号', () => {
      const result = sanitizeData('Call 13812345678 now') as string;
      expect(result).toBe('Call 138****5678 now');
    });

    it('不应误匹配非手机号 11 位数字', () => {
      const result = sanitizeData({ num: '12345678901' }) as Record<string, unknown>;
      expect(result.num).toBe('12345678901');
    });
  });

  describe('信用卡号脱敏', () => {
    it('应将 16 位无空格信用卡号替换为 [REDACTED]', () => {
      const result = sanitizeData({ card: '1234567890123456' }) as Record<string, unknown>;
      expect(result.card).toBe('[REDACTED]');
    });

    it('应将带空格格式的信用卡号替换为 [REDACTED]', () => {
      const result = sanitizeData({ card: '1234 5678 9012 3456' }) as Record<string, unknown>;
      expect(result.card).toBe('[REDACTED]');
    });

    it('应将带中划线格式的信用卡号替换为 [REDACTED]', () => {
      const result = sanitizeData({ card: '1234-5678-9012-3456' }) as Record<string, unknown>;
      expect(result.card).toBe('[REDACTED]');
    });

    it('应处理字符串中的信用卡号', () => {
      const result = sanitizeData('Card: 1234-5678-9012-3456') as string;
      expect(result).toBe('Card: [REDACTED]');
    });
  });

  describe('嵌套对象处理', () => {
    it('应递归过滤嵌套对象中的敏感字段', () => {
      const input = {
        user: {
          name: 'test',
          password: 'secret',
          settings: {
            api_key: 'key',
            theme: 'dark',
          },
        },
      };
      const result = sanitizeData(input) as any;
      expect(result.user.name).toBe('test');
      expect(result.user.password).toBe('[FILTERED]');
      expect(result.user.settings.api_key).toBe('[FILTERED]');
      expect(result.user.settings.theme).toBe('dark');
    });

    it('应处理数组中的对象', () => {
      const input = [
        { token: 'abc', value: 1 },
        { password: 'def', value: 2 },
      ];
      const result = sanitizeData(input) as any[];
      expect(result[0].token).toBe('[FILTERED]');
      expect(result[0].value).toBe(1);
      expect(result[1].password).toBe('[FILTERED]');
      expect(result[1].value).toBe(2);
    });

    it('应保留 null 和 undefined', () => {
      const result = sanitizeData({ a: null, b: undefined, c: { d: null } }) as any;
      expect(result.a).toBeNull();
      expect(result.b).toBeUndefined();
      expect(result.c.d).toBeNull();
    });

    it('应保留数字和布尔值', () => {
      const result = sanitizeData({ n: 42, b: false, f: 3.14 }) as Record<string, unknown>;
      expect(result.n).toBe(42);
      expect(result.b).toBe(false);
      expect(result.f).toBe(3.14);
    });
  });

  describe('自定义敏感字段列表', () => {
    it('应支持自定义敏感字段', () => {
      const result = sanitizeData(
        { customSecret: 'shh', password: 'secret' },
        ['customsecret']
      ) as Record<string, unknown>;
      expect(result.customSecret).toBe('[FILTERED]');
      expect(result.password).toBe('secret');
    });

    it('自定义字段应同样支持分隔符匹配', () => {
      const result = sanitizeData(
        { my_custom_secret: 'shh', data: { nested_custom_secret: 'x' } },
        ['customsecret']
      ) as any;
      expect(result.my_custom_secret).toBe('[FILTERED]');
      expect(result.data.nested_custom_secret).toBe('[FILTERED]');
    });
  });

  describe('混合敏感信息字符串', () => {
    it('应同时脱敏邮箱、手机号和信用卡号', () => {
      const input = 'Email: user@example.com, Phone: 13812345678, Card: 1234567890123456';
      const result = sanitizeData(input) as string;
      expect(result).toContain('us***@ex***');
      expect(result).toContain('138****5678');
      expect(result).toContain('[REDACTED]');
    });
  });
});
