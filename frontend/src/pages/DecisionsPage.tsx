import React, { useEffect } from 'react';
import { useTranslation } from '../App';
import { useProjectStore } from '../stores/projectStore';
import { DecisionMonitor } from '../components/decisions/DecisionMonitor';
import { Layout } from '../components/Layout';

export const DecisionsPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentProject, ensureDefaultProject } = useProjectStore();

  useEffect(() => {
    ensureDefaultProject();
  }, [ensureDefaultProject]);

  if (!currentProject) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">{t.pleaseSelectProject}</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t.decisions}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t.decisionsDesc}
          </p>
        </div>

        <DecisionMonitor
          projectId={currentProject.id}
          refreshInterval={5000}
        />
      </div>
    </Layout>
  );
};

export default DecisionsPage;
