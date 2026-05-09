import { signToken, verifyToken } from '../../../src/services/auth.js';

describe('Auth Service 纯函数', () => {
  describe('signToken / verifyToken', () => {
    it('应该签发并验证有效 token', () => {
      const userId = 'user-123';
      const token = signToken(userId);

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.userId).toBe(userId);
    });

    it('应该对不同用户生成不同 token', () => {
      const token1 = signToken('user-1');
      const token2 = signToken('user-2');
      expect(token1).not.toBe(token2);
    });

    it('应该对无效 token 返回 null', () => {
      expect(verifyToken('invalid-token')).toBeNull();
      expect(verifyToken('')).toBeNull();
      expect(verifyToken('eyJhbGciOiJIUzI1NiJ9.invalid.signature')).toBeNull();
    });

    it('应该对篡改的 token 返回 null', () => {
      const token = signToken('user-123');
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(verifyToken(tampered)).toBeNull();
    });

    it('应该生成包含 JWT 结构的 token', () => {
      const token = signToken('user-123');
      const parts = token.split('.');
      expect(parts.length).toBe(3); // header.payload.signature
    });
  });
});
