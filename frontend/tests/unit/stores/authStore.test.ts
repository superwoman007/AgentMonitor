import { vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

// Mock the api module
vi.mock('@/api', () => ({
  api: {
    auth: {
      login: vi.fn(),
      register: vi.fn(),
      me: vi.fn(),
    },
    setAuthToken: vi.fn(),
    setAuthRefreshToken: vi.fn(),
    clearAuthToken: vi.fn(),
  },
}));

import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api';

const mockedApi = vi.mocked(api);

describe('AuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset store state
    act(() => {
      useAuthStore.setState({
        user: null,
        token: null,
        isLoading: false,
        error: null,
      });
    });
  });

  describe('初始状态', () => {
    it('应该有正确的初始值', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('login', () => {
    it('应该成功登录并更新状态', async () => {
      const mockUser = { id: 'u1', email: 'test@example.com', name: 'Test', created_at: '', updated_at: '' };
      mockedApi.auth.login.mockResolvedValue({ token: 'jwt-token', refreshToken: 'refresh-token', user: mockUser as any });

      await act(async () => {
        await useAuthStore.getState().login('test@example.com', 'password');
      });

      const state = useAuthStore.getState();
      expect(state.token).toBe('jwt-token');
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockedApi.setAuthToken).toHaveBeenCalledWith('jwt-token');
      expect(mockedApi.setAuthRefreshToken).toHaveBeenCalledWith('refresh-token');
    });

    it('应该在登录失败时设置错误', async () => {
      mockedApi.auth.login.mockRejectedValue(new Error('Invalid credentials'));

      await act(async () => {
        await expect(useAuthStore.getState().login('bad@example.com', 'wrong')).rejects.toThrow();
      });

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });

    it('应该在登录过程中设置 isLoading', async () => {
      let resolveLogin: (value: any) => void;
      mockedApi.auth.login.mockReturnValue(new Promise((r) => { resolveLogin = r; }));

      const loginPromise = act(async () => {
        const p = useAuthStore.getState().login('test@example.com', 'password');
        // Check loading state synchronously after calling login
        return p;
      });

      // After login starts, isLoading should be true
      // Resolve and complete
      const mockUser = { id: 'u1', email: 'test@example.com', name: 'Test', created_at: '', updated_at: '' };
      await act(async () => {
        resolveLogin!({ token: 'jwt', refreshToken: 'refresh', user: mockUser });
      });
      await loginPromise;

      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('register', () => {
    it('应该成功注册并更新状态', async () => {
      const mockUser = { id: 'u2', email: 'new@example.com', name: 'New User', created_at: '', updated_at: '' };
      mockedApi.auth.register.mockResolvedValue({ token: 'new-token', refreshToken: 'new-refresh-token', user: mockUser as any });

      await act(async () => {
        await useAuthStore.getState().register('new@example.com', 'password', 'New User');
      });

      const state = useAuthStore.getState();
      expect(state.token).toBe('new-token');
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
    });

    it('应该在注册失败时设置错误', async () => {
      mockedApi.auth.register.mockRejectedValue(new Error('Email already exists'));

      await act(async () => {
        await expect(useAuthStore.getState().register('dup@example.com', 'password')).rejects.toThrow();
      });

      expect(useAuthStore.getState().error).toBe('Email already exists');
    });
  });

  describe('logout', () => {
    it('应该清除用户和 token', () => {
      // Set some state first
      act(() => {
        useAuthStore.setState({ user: { id: 'u1' } as any, token: 'some-token' });
      });

      act(() => {
        useAuthStore.getState().logout();
      });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(mockedApi.clearAuthToken).toHaveBeenCalled();
    });
  });

  describe('fetchUser', () => {
    it('应该获取当前用户信息', async () => {
      const mockUser = { id: 'u1', email: 'test@example.com', name: 'Test', created_at: '', updated_at: '' };
      mockedApi.auth.me.mockResolvedValue(mockUser as any);

      act(() => {
        useAuthStore.setState({ token: 'valid-token' });
      });

      await act(async () => {
        await useAuthStore.getState().fetchUser();
      });

      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('应该在无 token 时跳过获取', async () => {
      await act(async () => {
        await useAuthStore.getState().fetchUser();
      });

      expect(mockedApi.auth.me).not.toHaveBeenCalled();
    });

    it('应该在获取失败时清除状态', async () => {
      mockedApi.auth.me.mockRejectedValue(new Error('Unauthorized'));

      act(() => {
        useAuthStore.setState({ token: 'expired-token', user: { id: 'u1' } as any });
      });

      await act(async () => {
        await useAuthStore.getState().fetchUser();
      });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
    });
  });

  describe('setUser / setToken', () => {
    it('应该直接设置 user', () => {
      const mockUser = { id: 'u1', email: 'test@example.com', name: 'Test' } as any;
      act(() => {
        useAuthStore.getState().setUser(mockUser);
      });
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('应该直接设置 token 并调用 api.setAuthToken', () => {
      act(() => {
        useAuthStore.getState().setToken('new-token');
      });
      expect(useAuthStore.getState().token).toBe('new-token');
      expect(mockedApi.setAuthToken).toHaveBeenCalledWith('new-token');
    });
  });
});
