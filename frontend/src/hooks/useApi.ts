import { useAuthStore } from '../stores/authStore';

export const useApi = () => {
  const { token } = useAuthStore();

  const fetchApi = async (url: string, options?: RequestInit) => {
    const response = await fetch(`http://localhost:3000${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  };

  return { fetchApi };
};
