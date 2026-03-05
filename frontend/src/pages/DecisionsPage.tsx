import React from 'react';
import { useTranslation } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { DecisionMonitor } from '../../components/decisions/DecisionMonitor';

export const DecisionsPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();

  if (!currentProject) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <p>{t('errors.noProjectSelected')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('nav.decisions')}</h1>
        <p className="page-description">
          Monitor and analyze your agent's decision-making patterns
        </p>
      </div>

      <DecisionMonitor
        projectId={currentProject.id}
        refreshInterval={5000}
      />
    </div>
  );
};

export default DecisionsPage;
