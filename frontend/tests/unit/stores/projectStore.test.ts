import { vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/api', () => ({
  api: {
    projects: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { useProjectStore } from '@/stores/projectStore';
import { api } from '@/api';

const mockedApi = vi.mocked(api);

describe('ProjectStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    act(() => {
      useProjectStore.setState({
        projects: [],
        currentProject: null,
        isLoading: false,
        error: null,
      });
    });
  });

  describe('初始状态', () => {
    it('应该有正确的初始值', () => {
      const state = useProjectStore.getState();
      expect(state.projects).toEqual([]);
      expect(state.currentProject).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('fetchProjects', () => {
    it('应该成功获取项目列表', async () => {
      const mockProjects = [
        { id: 'p1', name: 'Project 1', user_id: 'u1', created_at: '', updated_at: '' },
        { id: 'p2', name: 'Project 2', user_id: 'u1', created_at: '', updated_at: '' },
      ];
      mockedApi.projects.list.mockResolvedValue({ projects: mockProjects } as any);

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      const state = useProjectStore.getState();
      expect(state.projects).toEqual(mockProjects);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('应该在无当前项目时自动选择第一个', async () => {
      const mockProjects = [
        { id: 'p1', name: 'Project 1', user_id: 'u1', created_at: '', updated_at: '' },
      ];
      mockedApi.projects.list.mockResolvedValue({ projects: mockProjects } as any);

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      expect(useProjectStore.getState().currentProject).toEqual(mockProjects[0]);
    });

    it('应该在已有当前项目时不覆盖', async () => {
      const existing = { id: 'p0', name: 'Existing', user_id: 'u1', created_at: '', updated_at: '' };
      act(() => {
        useProjectStore.setState({ currentProject: existing as any });
      });

      const mockProjects = [
        { id: 'p1', name: 'Project 1', user_id: 'u1', created_at: '', updated_at: '' },
      ];
      mockedApi.projects.list.mockResolvedValue({ projects: mockProjects } as any);

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      expect(useProjectStore.getState().currentProject).toEqual(existing);
    });

    it('应该在获取失败时设置错误', async () => {
      mockedApi.projects.list.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await useProjectStore.getState().fetchProjects();
      });

      expect(useProjectStore.getState().error).toBe('Network error');
      expect(useProjectStore.getState().isLoading).toBe(false);
    });
  });

  describe('setCurrentProject', () => {
    it('应该设置当前项目', () => {
      const project = { id: 'p1', name: 'Test' } as any;
      act(() => {
        useProjectStore.getState().setCurrentProject(project);
      });
      expect(useProjectStore.getState().currentProject).toEqual(project);
    });

    it('应该支持清除当前项目', () => {
      act(() => {
        useProjectStore.setState({ currentProject: { id: 'p1' } as any });
      });
      act(() => {
        useProjectStore.getState().setCurrentProject(null);
      });
      expect(useProjectStore.getState().currentProject).toBeNull();
    });
  });

  describe('createProject', () => {
    it('应该创建项目并添加到列表', async () => {
      const newProject = { id: 'p-new', name: 'New', user_id: 'u1', created_at: '', updated_at: '' };
      mockedApi.projects.create.mockResolvedValue({ project: newProject } as any);

      await act(async () => {
        const result = await useProjectStore.getState().createProject('New');
        expect(result).toEqual(newProject);
      });

      expect(useProjectStore.getState().projects).toContainEqual(newProject);
    });

    it('应该在创建失败时设置错误并抛出', async () => {
      mockedApi.projects.create.mockRejectedValue(new Error('Duplicate name'));

      await act(async () => {
        await expect(
          useProjectStore.getState().createProject('Dup')
        ).rejects.toThrow('Duplicate name');
      });

      expect(useProjectStore.getState().error).toBe('Duplicate name');
    });
  });

  describe('updateProject', () => {
    it('应该更新列表中的项目', async () => {
      const original = { id: 'p1', name: 'Old', user_id: 'u1', created_at: '', updated_at: '' };
      const updated = { id: 'p1', name: 'Updated', user_id: 'u1', created_at: '', updated_at: '' };

      act(() => {
        useProjectStore.setState({ projects: [original as any] });
      });

      mockedApi.projects.update.mockResolvedValue({ project: updated } as any);

      await act(async () => {
        await useProjectStore.getState().updateProject('p1', { name: 'Updated' });
      });

      expect(useProjectStore.getState().projects[0]).toEqual(updated);
    });

    it('应该同步更新 currentProject', async () => {
      const original = { id: 'p1', name: 'Old', user_id: 'u1', created_at: '', updated_at: '' };
      const updated = { id: 'p1', name: 'Updated', user_id: 'u1', created_at: '', updated_at: '' };

      act(() => {
        useProjectStore.setState({ projects: [original as any], currentProject: original as any });
      });

      mockedApi.projects.update.mockResolvedValue({ project: updated } as any);

      await act(async () => {
        await useProjectStore.getState().updateProject('p1', { name: 'Updated' });
      });

      expect(useProjectStore.getState().currentProject).toEqual(updated);
    });
  });

  describe('deleteProject', () => {
    it('应该从列表中移除项目', async () => {
      act(() => {
        useProjectStore.setState({
          projects: [
            { id: 'p1', name: 'Keep' } as any,
            { id: 'p2', name: 'Delete' } as any,
          ],
        });
      });

      mockedApi.projects.delete.mockResolvedValue(undefined as any);

      await act(async () => {
        await useProjectStore.getState().deleteProject('p2');
      });

      const projects = useProjectStore.getState().projects;
      expect(projects.length).toBe(1);
      expect(projects[0].id).toBe('p1');
    });

    it('应该在删除当前项目时切换到第一个', async () => {
      const p1 = { id: 'p1', name: 'First' } as any;
      const p2 = { id: 'p2', name: 'Current' } as any;

      act(() => {
        useProjectStore.setState({ projects: [p1, p2], currentProject: p2 });
      });

      mockedApi.projects.delete.mockResolvedValue(undefined as any);

      await act(async () => {
        await useProjectStore.getState().deleteProject('p2');
      });

      expect(useProjectStore.getState().currentProject).toEqual(p1);
    });

    it('应该在删除唯一项目时设置 currentProject 为 null', async () => {
      const p1 = { id: 'p1', name: 'Only' } as any;

      act(() => {
        useProjectStore.setState({ projects: [p1], currentProject: p1 });
      });

      mockedApi.projects.delete.mockResolvedValue(undefined as any);

      await act(async () => {
        await useProjectStore.getState().deleteProject('p1');
      });

      expect(useProjectStore.getState().currentProject).toBeNull();
    });
  });

  describe('ensureDefaultProject', () => {
    it('应该在已有当前项目时直接返回', async () => {
      const existing = { id: 'p1', name: 'Existing' } as any;
      act(() => {
        useProjectStore.setState({ currentProject: existing });
      });

      let result: any;
      await act(async () => {
        result = await useProjectStore.getState().ensureDefaultProject();
      });

      expect(result).toEqual(existing);
      expect(mockedApi.projects.list).not.toHaveBeenCalled();
    });

    it('应该在无项目时创建默认项目', async () => {
      const created = { id: 'p-default', name: 'Default Project', user_id: 'u1', created_at: '', updated_at: '' };
      mockedApi.projects.list.mockResolvedValue({ projects: [] } as any);
      mockedApi.projects.create.mockResolvedValue({ project: created } as any);

      let result: any;
      await act(async () => {
        result = await useProjectStore.getState().ensureDefaultProject();
      });

      expect(result).toEqual(created);
      expect(mockedApi.projects.create).toHaveBeenCalledWith({
        name: 'Default Project',
        description: 'Default project created automatically',
      });
    });

    it('应该优先选择名为 Default Project 的项目', async () => {
      const projects = [
        { id: 'p1', name: 'Other', user_id: 'u1', created_at: '', updated_at: '' },
        { id: 'p2', name: 'Default Project', user_id: 'u1', created_at: '', updated_at: '' },
      ];
      mockedApi.projects.list.mockResolvedValue({ projects } as any);

      let result: any;
      await act(async () => {
        result = await useProjectStore.getState().ensureDefaultProject();
      });

      expect(result).toEqual(projects[1]);
    });
  });
});
