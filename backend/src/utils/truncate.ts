const MAX_TOTAL_SIZE = 512 * 1024; // 512KB

function getByteLength(str: string): number {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(str, 'utf8');
  }
  return new TextEncoder().encode(str).length;
}

export function truncateJson(data: unknown, maxBytes: number = MAX_TOTAL_SIZE, fieldName?: string): unknown {
  if (data === undefined) return data;

  const str = JSON.stringify(data);
  const shouldTruncate = getByteLength(str) > maxBytes ||
    (Array.isArray(data) && data.length > 50) ||
    (typeof data === 'object' && data !== null && Object.keys(data).length > 50);

  if (!shouldTruncate) return data;

  if (typeof data === 'string') {
    const truncated = data.slice(0, 10000);
    return `${truncated}... [truncated, total: ${data.length} chars]`;
  }

  if (Array.isArray(data)) {
    const result: unknown[] = [];
    let currentSize = 0;
    for (let i = 0; i < data.length; i++) {
      const itemStr = JSON.stringify(data[i]);
      if (currentSize + getByteLength(itemStr) > maxBytes || i >= 50) {
        result.push({ _truncated: true, total: data.length });
        break;
      }
      result.push(data[i]);
      currentSize += getByteLength(itemStr);
    }
    return result;
  }

  if (typeof data === 'object' && data !== null) {
    const result: Record<string, unknown> = {};
    let currentSize = 0;
    const entries = Object.entries(data);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const entryStr = JSON.stringify({ [key]: value });
      if (currentSize + getByteLength(entryStr) > maxBytes || i >= 50) {
        result._truncated = true;
        result._total = entries.length;
        break;
      }
      result[key] = value;
      currentSize += getByteLength(entryStr);
    }
    return result;
  }

  return data;
}
