const DEFAULT_SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'api_key', 'apikey', 'authorization',
  'cookie', 'credit_card', 'ssn', 'social_security', 'private_key',
];

export function sanitizeData(data: unknown, sensitiveKeys?: string[]): unknown {
  const keys = sensitiveKeys || DEFAULT_SENSITIVE_KEYS;
  return sanitizeValue(data, keys);
}

function sanitizeValue(value: unknown, keys: string[]): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map(v => sanitizeValue(v, keys));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      // 使用词边界匹配：键名完全匹配，或以 _ / - / . 分隔的单词匹配
      const keyParts = lowerKey.split(/[_\-.]/);
      const keySubseqs = generateNormalizedSubsequences(keyParts);
      if (keys.some(sk => {
        const skLower = sk.toLowerCase();
        const skParts = skLower.split(/[_\-.]/);
        const normalizedSk = skParts.join('');
        return lowerKey === skLower || keyParts.includes(skLower) || keySubseqs.includes(normalizedSk);
      })) {
        result[key] = '[FILTERED]';
      } else {
        result[key] = sanitizeValue(val, keys);
      }
    }
    return result;
  }

  return value;
}

function generateNormalizedSubsequences(parts: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= parts.length; j++) {
      result.push(parts.slice(i, j).join(''));
    }
  }
  return result;
}

function sanitizeString(str: string): string {
  str = str.replace(/[\w.-]+@[\w.-]+\.\w+/g, (match) => {
    const [local, domain] = match.split('@');
    return `${local.slice(0, 2)}***@${domain.slice(0, 2)}***`;
  });
  str = str.replace(/1[3-9]\d{9}/g, (match) => {
    return `${match.slice(0, 3)}****${match.slice(-4)}`;
  });
  str = str.replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[REDACTED]');
  return str;
}
