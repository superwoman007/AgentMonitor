import { useCallback, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';

export const useApi = () => {
  const { token } = useAuthStore();

  const fetchApi = useCallback(async (url: string, options?: RequestInit) => {
    // 使用相对路径，让 Vite 代理处理请求
    // 如果 url 已经以 /api 开头，直接使用；否则添加 /api 前缀
    const apiPath = url.startsWith('/api') ? url : `/api${url}`;
    
    const response = await fetch(apiPath, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      // 尝试解析错误信息，如果解析失败则使用默认错误
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // 忽略 JSON 解析错误
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }, [token]);

  return useMemo(() => ({ fetchApi }), [fetchApi]);
};
