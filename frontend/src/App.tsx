import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { i18n, Lang, TranslationKey } from './i18n';
import { useAuthStore } from './stores/authStore';
import { useProjectStore } from './stores/projectStore';

import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { DebuggingPage } from './pages/DebuggingPage';
import { SettingsPage } from './pages/SettingsPage';
import { QualityPage } from './pages/QualityPage';
import { CostPage } from './pages/CostPage';
import { AlertsPage } from './pages/AlertsPage';
import { ProtectedRoute } from './components/ProtectedRoute';

interface TranslationContextType {
  t: typeof i18n.en;
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const TranslationContext = createContext<TranslationContextType>({
  t: i18n.en,
  lang: 'zh',
  setLang: () => {},
});

export function useTranslation() {
  return useContext(TranslationContext);
}

function TranslationProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem('lang');
      return stored === 'en' || stored === 'zh' ? stored : 'zh';
    } catch {
      return 'zh';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('lang', lang);
    } catch {
      return;
    }
  }, [lang]);

  const t = i18n[lang];

  return (
    <TranslationContext.Provider value={{ t, lang, setLang }}>
      {children}
    </TranslationContext.Provider>
  );
}

function AppRoutes() {
  const { token, user, fetchUser } = useAuthStore();
  const { ensureDefaultProject } = useProjectStore();

  useEffect(() => {
    if (token && !user) {
      fetchUser();
    }
  }, [token, user, fetchUser]);

  useEffect(() => {
    if (token) {
      ensureDefaultProject();
    }
  }, [token, ensureDefaultProject]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions"
        element={
          <ProtectedRoute>
            <SessionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions/:id"
        element={
          <ProtectedRoute>
            <SessionDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/debugging"
        element={
          <ProtectedRoute>
            <DebuggingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quality"
        element={
          <ProtectedRoute>
            <QualityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cost"
        element={
          <ProtectedRoute>
            <CostPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/alerts"
        element={
          <ProtectedRoute>
            <AlertsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TranslationProvider>
        <AppRoutes />
      </TranslationProvider>
    </BrowserRouter>
  );
}

export { i18n };
export type { Lang, TranslationKey };
