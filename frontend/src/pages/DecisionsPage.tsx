import React from 'react';
import { useTranslation } from '../App';
import { useProjectStore } from '../stores/projectStore';
import { DecisionMonitor } from '../components/decisions/DecisionMonitor';

export const DecisionsPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();

  if (!currentProject) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <p>Please select a project</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t.decisions}</h1>
        <p className="page-description">
          {t.decisionsDesc}
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
