import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from '../App';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();

  const navGroups: NavGroup[] = [
    {
      title: t.navObservation || '观测中心',
      items: [
        { path: '/dashboard', label: t.dashboard, icon: '📊' },
        { path: '/traces', label: t.traces || 'Traces', icon: '🔍' },
        { path: '/sessions', label: t.sessions, icon: '💬' },
        { path: '/alerts', label: t.alerts, icon: '🔔' },
      ],
    },
    {
      title: t.navEvaluation || '评测优化',
      items: [
        { path: '/evaluation', label: t.evaluation, icon: '🧪' },
        { path: '/prompts', label: t.prompts, icon: '📝' },
        { path: '/model-configs', label: t.modelConfigs, icon: '🤖' },
        { path: '/quality', label: t.quality, icon: '⭐' },
        { path: '/cost', label: t.cost, icon: '💰' },
        { path: '/feedback', label: 'Feedback', icon: '💬' },
      ],
    },
    {
      title: t.navAnalysis || '分析',
      items: [
        { path: '/decisions', label: t.decisions, icon: '🧠' },
      ],
    },
    {
      title: t.navDev || '开发调试',
      items: [
        { path: '/debugging', label: t.debugging, icon: '🐛' },
      ],
    },
    {
      title: t.navSystem || '系统',
      items: [
        { path: '/settings', label: t.settings, icon: '⚙️' },
      ],
    },
  ];

  return (
    <aside className="w-56 bg-white border-r flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold text-gray-900">{t.title}</h1>
        <p className="text-xs text-gray-500">{t.subtitle}</p>
      </div>

      <nav className="flex-1 p-3 overflow-auto">
        <div className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.title}>
              <h3 className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                {group.title}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        className={() =>
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
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="p-4 border-t text-xs text-gray-400">
        AgentMonitor v0.1.0
      </div>
    </aside>
  );
}
