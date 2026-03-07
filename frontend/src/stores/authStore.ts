import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { api, User } from '../api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
}

const storage = (() => {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem: (key: string) => {
      try {
        localStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
})();

type AuthPersisted = { token: string | null; user: User | null };

const persistStorage: PersistStorage<AuthPersisted> = {
  getItem: (name) => {
    const str = storage.getItem(name);
    if (!str) return null;
    try {
      return JSON.parse(str) as StorageValue<AuthPersisted>;
    } catch {
      storage.removeItem(name);
      return null;
    }
  },
  setItem: (name, value) => {
    storage.setItem(name, JSON.stringify(value));
  },
  removeItem: (name) => {
    storage.removeItem(name);
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await api.auth.login({ email, password });
          api.setAuthToken(token);
          set({ token, user, isLoading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      register: async (email: string, password: string, name?: string) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await api.auth.register({ email, password, name });
          api.setAuthToken(token);
          set({ token, user, isLoading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Registration failed';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      logout: () => {
        api.clearAuthToken();
        set({ user: null, token: null });
      },

      fetchUser: async () => {
        const { token } = get();
        if (!token) return;

        set({ isLoading: true });
        try {
          const user = await api.auth.me();
          set({ user, isLoading: false });
        } catch {
          set({ user: null, token: null, isLoading: false });
        }
      },

      setUser: (user) => set({ user }),
      setToken: (token) => {
        if (token) {
          api.setAuthToken(token);
        }
        set({ token });
      },
    }),
    {
      name: 'auth-storage',
      storage: persistStorage,
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);
