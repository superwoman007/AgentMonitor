import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
        const { projects, fetchProjects, createProject, setCurrentProject } = get();

        if (projects.length === 0) {
          await fetchProjects();
        }

        const { projects: updatedProjects } = get();
        if (updatedProjects.length === 0) {
          try {
            const project = await createProject('Default Project', 'Default project created automatically');
            setCurrentProject(project);
            return project;
          } catch {
            return null;
          }
        }

        const { currentProject } = get();
        if (!currentProject && updatedProjects.length > 0) {
          set({ currentProject: updatedProjects[0] });
        }

        return get().currentProject;
      },
    }),
    {
      name: 'project-storage',
      partialize: (state) => ({ currentProjectId: state.currentProject?.id }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const stored = localStorage.getItem('project-storage');
          if (stored) {
            const { state: persisted } = JSON.parse(stored);
            if (persisted?.currentProjectId) {
              api.projects.get(persisted.currentProjectId).then(({ project }) => {
                state.setCurrentProject(project);
              }).catch(() => {
                state.setCurrentProject(null);
              });
            }
          }
        }
      },
    }
  )
);
