import { useProjectStore } from '../stores/projectStore';
import { useTranslation } from '../App';
import { useState, useRef, useEffect } from 'react';

export function ProjectSelector() {
  const { projects, currentProject, setCurrentProject, isLoading } = useProjectStore();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (projects.length === 0 && !isLoading) {
    return (
      <span className="text-sm text-gray-500">{t.noProject}</span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
      >
        <span className="text-base">📁</span>
        <span className="max-w-[150px] truncate">
          {currentProject?.name || t.selectProject}
        </span>
        <span className="text-xs">▼</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-md shadow-lg border z-20">
          <ul className="py-1 max-h-60 overflow-auto">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  onClick={() => {
                    setCurrentProject(project);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                    currentProject?.id === project.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700'
                  }`}
                >
                  {project.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
