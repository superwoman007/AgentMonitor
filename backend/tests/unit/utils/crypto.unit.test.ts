import { encrypt, decrypt, hashApiKey, generateApiKey } from '../../../src/utils/crypto.js';

describe('Crypto Utils', () => {
  describe('encrypt / decrypt', () => {
    it('应该加密并解密文本', () => {
      const plaintext = 'hello world';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('应该对相同文本生成不同密文（随机 IV）', () => {
      const plaintext = 'same text';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('应该正确处理空字符串', () => {
      const encrypted = encrypt('');
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('应该正确处理中文文本', () => {
      const plaintext = '你好世界，这是一个测试';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('应该正确处理长文本', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('应该正确处理特殊字符', () => {
      const plaintext = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./~`\n\t';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('加密结果应该包含 iv:ciphertext 格式', () => {
      const encrypted = encrypt('test');
      expect(encrypted).toContain(':');
      const parts = encrypted.split(':');
      expect(parts.length).toBe(2);
    });

    it('应该对无效密文抛出错误', () => {
      expect(() => decrypt('invalid')).toThrow();
      expect(() => decrypt('not:valid:format')).toThrow();
    });
  });

  describe('hashApiKey', () => {
    it('应该返回 SHA256 哈希', () => {
      const hash = hashApiKey('am_testkey123');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA256 hex = 64 chars
    });

    it('应该对相同输入返回相同哈希', () => {
      const hash1 = hashApiKey('am_testkey');
      const hash2 = hashApiKey('am_testkey');
      expect(hash1).toBe(hash2);
    });

    it('应该对不同输入返回不同哈希', () => {
      const hash1 = hashApiKey('am_key1');
      const hash2 = hashApiKey('am_key2');
      expect(hash1).not.toBe(hash2);
    });

    it('应该只包含十六进制字符', () => {
      const hash = hashApiKey('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('generateApiKey', () => {
    it('应该生成以 am_ 开头的 key', () => {
      const key = generateApiKey();
      expect(key.startsWith('am_')).toBe(true);
    });

    it('应该生成正确长度的 key', () => {
      const key = generateApiKey();
      // am_ (3) + 32 chars = 35
      expect(key.length).toBe(35);
    });

    it('应该只包含字母数字字符', () => {
      const key = generateApiKey();
      const body = key.slice(3); // 去掉 am_ 前缀
      expect(body).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('应该每次生成不同的 key', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      expect(keys.size).toBe(100);
    });
  });
});
