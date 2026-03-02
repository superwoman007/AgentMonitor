import { NavLink } from 'react-router-dom';
import { useTranslation } from '../App';

export function Sidebar() {
  const { t } = useTranslation();

  const navItems = [
    { path: '/dashboard', label: t.dashboard, icon: '📊' },
    { path: '/sessions', label: t.sessions, icon: '💬' },
    { path: '/quality', label: t.quality, icon: '⭐' },
    { path: '/cost', label: t.cost, icon: '💰' },
    { path: '/alerts', label: t.alerts, icon: '🔔' },
    { path: '/debugging', label: t.debugging, icon: '🐛' },
    { path: '/settings', label: t.settings, icon: '⚙️' },
  ];

  return (
    <aside className="w-56 bg-white border-r flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold text-gray-900">{t.title}</h1>
        <p className="text-xs text-gray-500">{t.subtitle}</p>
      </div>

      <nav className="flex-1 p-3">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t text-xs text-gray-400">
        AgentMonitor v0.1.0
      </div>
    </aside>
  );
}
