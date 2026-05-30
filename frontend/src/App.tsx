import { createContext, useContext, useState, useEffect, ReactNode, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { i18n, Lang } from './i18n';
import { useAuthStore } from './stores/authStore';
import { useProjectStore } from './stores/projectStore';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded pages for code splitting
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const SessionsPage = lazy(() => import('./pages/SessionsPage').then(m => ({ default: m.SessionsPage })));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage').then(m => ({ default: m.SessionDetailPage })));
const DebuggingPage = lazy(() => import('./pages/DebuggingPage').then(m => ({ default: m.DebuggingPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const QualityPage = lazy(() => import('./pages/QualityPage').then(m => ({ default: m.QualityPage })));
const CostPage = lazy(() => import('./pages/CostPage').then(m => ({ default: m.CostPage })));
const AlertsPage = lazy(() => import('./pages/AlertsPage').then(m => ({ default: m.AlertsPage })));
const DecisionsPage = lazy(() => import('./pages/DecisionsPage').then(m => ({ default: m.DecisionsPage })));
const EvaluationPage = lazy(() => import('./pages/EvaluationPage').then(m => ({ default: m.EvaluationPage })));
const PromptsPage = lazy(() => import('./pages/PromptsPage').then(m => ({ default: m.PromptsPage })));
const TracesPage = lazy(() => import('./pages/TracesPage').then(m => ({ default: m.TracesPage })));
const TraceDetailPage = lazy(() => import('./pages/TraceDetailPage').then(m => ({ default: m.TraceDetailPage })));
const ModelConfigsPage = lazy(() => import('./pages/ModelConfigsPage').then(m => ({ default: m.ModelConfigsPage })));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage').then(m => ({ default: m.FeedbackPage })));

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

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}

function TranslationProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('lang') as Lang) || 'zh';
  });

  const t = i18n[lang];

  useEffect(() => {
    localStorage.setItem('lang', lang);
  }, [lang]);

  return (
    <TranslationContext.Provider value={{ t, lang, setLang }}>
      {children}
    </TranslationContext.Provider>
  );
}

function AppRoutes() {
  const { token } = useAuthStore();
  const { fetchProjects } = useProjectStore();

  useEffect(() => {
    if (token) {
      fetchProjects();
    }
  }, [token, fetchProjects]);

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/sessions" element={<ProtectedRoute><SessionsPage /></ProtectedRoute>} />
        <Route path="/sessions/:id" element={<ProtectedRoute><SessionDetailPage /></ProtectedRoute>} />
        <Route path="/debugging" element={<ProtectedRoute><DebuggingPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/quality" element={<ProtectedRoute><QualityPage /></ProtectedRoute>} />
        <Route path="/cost" element={<ProtectedRoute><CostPage /></ProtectedRoute>} />
        <Route path="/alerts" element={<ProtectedRoute><AlertsPage /></ProtectedRoute>} />
        <Route path="/decisions" element={<ProtectedRoute><DecisionsPage /></ProtectedRoute>} />
        <Route path="/evaluation" element={<ProtectedRoute><EvaluationPage /></ProtectedRoute>} />
        <Route path="/prompts" element={<ProtectedRoute><PromptsPage /></ProtectedRoute>} />
        <Route path="/traces" element={<ProtectedRoute><TracesPage /></ProtectedRoute>} />
        <Route path="/traces/:id" element={<ProtectedRoute><TraceDetailPage /></ProtectedRoute>} />
        <Route path="/model-configs" element={<ProtectedRoute><ModelConfigsPage /></ProtectedRoute>} />
        <Route path="/feedback" element={<ProtectedRoute><FeedbackPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TranslationProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TranslationProvider>
    </ErrorBoundary>
  );
}
