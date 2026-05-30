import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WizardStepIndicator } from './WizardStepIndicator';
import { EvalWizardStep1 } from './EvalWizardStep1';
import { EvalWizardStep2 } from './EvalWizardStep2';
import { EvalWizardStep3 } from './EvalWizardStep3';

interface EvalWizardProps {
  projectId: string;
  traceIds: string[];
  onClose: () => void;
}

const STEPS = ['选择数据集', '选择评测器', '启动实验'];

export function EvalWizard({ projectId, traceIds, onClose }: EvalWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [datasetId, setDatasetId] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('');

  const handleStep1Next = (dsId: string, dsName: string) => {
    setDatasetId(dsId);
    setDatasetName(dsName);
    setStep(1);
  };

  const handleStep2Next = (_evId: string, evName: string) => {
    setEvaluatorName(evName);
    setStep(2);
  };

  const handleComplete = (experimentId: string) => {
    navigate(`/evaluation?experimentId=${experimentId}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold mb-4">快速评测向导</h2>
        <WizardStepIndicator currentStep={step} steps={STEPS} />

        {step === 0 && (
          <EvalWizardStep1
            projectId={projectId}
            traceIds={traceIds}
            onNext={handleStep1Next}
            onCancel={onClose}
          />
        )}
        {step === 1 && (
          <EvalWizardStep2
            projectId={projectId}
            onNext={handleStep2Next}
            onBack={() => setStep(0)}
            onCancel={onClose}
          />
        )}
        {step === 2 && (
          <EvalWizardStep3
            projectId={projectId}
            datasetId={datasetId}
            datasetName={datasetName}
            evaluatorName={evaluatorName}
            traceCount={traceIds.length}
            onComplete={handleComplete}
            onBack={() => setStep(1)}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}
