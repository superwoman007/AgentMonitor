import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { api, Project } from '../api';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, data: { name?: string; description?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  ensureDefaultProject: () => Promise<Project | null>;
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

type ProjectPersisted = { currentProjectId?: string };

const persistStorage: PersistStorage<ProjectPersisted> = {
  getItem: (name) => {
    const str = storage.getItem(name);
    if (!str) return null;
    try {
      return JSON.parse(str) as StorageValue<ProjectPersisted>;
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

let ensureDefaultProjectPromise: Promise<Project | null> | null = null;

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProject: null,
      isLoading: false,
      error: null,

      fetchProjects: async () => {
        set({ isLoading: true, error: null });
        try {
          const { projects } = await api.projects.list();
          set({ projects, isLoading: false });

          const { currentProject } = get();
          if (!currentProject && projects.length > 0) {
            set({ currentProject: projects[0] });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch projects';
          set({ error: message, isLoading: false });
        }
      },

      setCurrentProject: (project) => set({ currentProject: project }),

      createProject: async (name: string, description?: string) => {
        set({ isLoading: true, error: null });
        try {
          const { project } = await api.projects.create({ name, description });
          set((state) => ({
            projects: [...state.projects, project],
            isLoading: false,
          }));
          return project;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to create project';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      updateProject: async (id: string, data: { name?: string; description?: string }) => {
        set({ isLoading: true, error: null });
        try {
          const { project } = await api.projects.update(id, data);
          set((state) => ({
            projects: state.projects.map((p) => (p.id === id ? project : p)),
            currentProject: state.currentProject?.id === id ? project : state.currentProject,
            isLoading: false,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to update project';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      deleteProject: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          await api.projects.delete(id);
          set((state) => {
            const newProjects = state.projects.filter((p) => p.id !== id);
            return {
              projects: newProjects,
              currentProject:
                state.currentProject?.id === id
                  ? newProjects[0] || null
                  : state.currentProject,
              isLoading: false,
            };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete project';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      ensureDefaultProject: async () => {
        const existing = get().currentProject;
        if (existing) return existing;

        if (ensureDefaultProjectPromise) return ensureDefaultProjectPromise;

        ensureDefaultProjectPromise = (async () => {
          const { projects, fetchProjects, createProject, setCurrentProject } = get();

          if (projects.length === 0) {
            await fetchProjects();
          }

          const { projects: updatedProjects } = get();

          if (updatedProjects.length > 0) {
            const preferred =
              updatedProjects.find((p) => p.name === 'Default Project') ?? updatedProjects[0];
            setCurrentProject(preferred);
            return preferred;
          }

          try {
            const created = await createProject('Default Project', 'Default project created automatically');
            setCurrentProject(created);
            return created;
          } catch {
            return null;
          }
        })().finally(() => {
          ensureDefaultProjectPromise = null;
        });

        return ensureDefaultProjectPromise;
      },
    }),
    {
      name: 'project-storage',
      storage: persistStorage,
      partialize: (state) => ({ currentProjectId: state.currentProject?.id }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const stored = storage.getItem('project-storage');
          if (stored) {
            try {
              const { state: persisted } = JSON.parse(stored);
              if (persisted?.currentProjectId) {
                api.projects
                  .get(persisted.currentProjectId)
                  .then(({ project }) => {
                    state.setCurrentProject(project);
                  })
                  .catch(() => {
                    state.setCurrentProject(null);
                  });
              }
            } catch {
              state.setCurrentProject(null);
            }
          }
        }
      },
    }
  )
);
