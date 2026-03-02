import crypto from 'crypto';
import { config } from '../config.js';

// 从 JWT_SECRET 派生加密密钥，或使用专门的加密密钥
const ENCRYPTION_KEY = (config.jwt.secret || 'default-key').padEnd(32, '0').slice(0, 32);

/**
 * 加密文本
 * @param text 要加密的明文
 * @returns 加密后的 base64 字符串
 */
export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    // 返回 iv + 密文
    return iv.toString('base64') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * 解密文本
 * @param encryptedData 加密后的字符串（iv:密文格式）
 * @returns 解密后的明文
 */
export function decrypt(encryptedData: string): string {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Decryption failed');
  }
}

/**
 * 哈希 API Key（用于验证）
 * @param key API Key 明文
 * @returns SHA256 哈希值
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * 生成随机 API Key
 * @returns 格式为 am_xxxx 的随机字符串（只包含字母数字）
 */
export function generateApiKey(): string {
  const API_KEY_PREFIX = 'am_';
  const API_KEY_LENGTH = 32;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomBytes = crypto.randomBytes(API_KEY_LENGTH);
  for (let i = 0; i < API_KEY_LENGTH; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return API_KEY_PREFIX + result;
}
