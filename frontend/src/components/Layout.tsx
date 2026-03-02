import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useProjectStore } from '../stores/projectStore';
import { Sidebar } from './Sidebar';
import { ProjectSelector } from './ProjectSelector';
import { LanguageToggle } from './LanguageToggle';
import { ConnectionStatus } from './ConnectionStatus';
import { useTranslation } from '../App';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  useLocation();
  const { user, logout } = useAuthStore();
  useProjectStore();
  const { t, lang, setLang } = useTranslation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleUserClick = () => {
    if (confirm(`${t.logout}?`)) {
      handleLogout();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        <header className="bg-white shadow-sm border-b sticky top-0 z-10">
          <div className="px-4 py-3 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <ProjectSelector />
            </div>

            <div className="flex items-center gap-3">
              <ConnectionStatus />
              <LanguageToggle lang={lang} setLang={setLang} />
              {user && (
                <button
                  onClick={handleUserClick}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
                  title={user.email}
                >
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                    {(user.name || user.email)[0].toUpperCase()}
                  </div>
                  <span className="hidden sm:inline">{user.name || user.email.split('@')[0]}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
