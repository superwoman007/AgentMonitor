import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../App';
import { WizardStepIndicator } from './WizardStepIndicator';
import { EvalWizardStep1 } from './EvalWizardStep1';
import { EvalWizardStep2 } from './EvalWizardStep2';
import { EvalWizardStep3 } from './EvalWizardStep3';

interface EvalWizardProps {
  projectId: string;
  traceIds: string[];
  onClose: () => void;
}

/**
 * 快速评测向导弹窗
 * @param projectId - 当前项目 ID
 * @param traceIds - 参与评测的 Trace ID 列表
 * @param onClose - 关闭弹窗回调
 * @returns 评测向导组件
 */
export function EvalWizard({ projectId, traceIds, onClose }: EvalWizardProps) {
  const navigate = useNavigate();
  const { t, lang } = useTranslation();
  const [step, setStep] = useState(0);
  const [datasetId, setDatasetId] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [evaluatorId, setEvaluatorId] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('');
  const [evaluatorVersionId, setEvaluatorVersionId] = useState('');
  const steps = [t.selectDataset, t.selectEvaluator, t.startExperiment];
  const title = lang === 'zh' ? '快速评测向导' : 'Quick Evaluation Wizard';

  /**
   * 处理第一步完成后的数据集结果
   * @param dsId - 数据集 ID
   * @param dsName - 数据集名称
   * @returns 无返回值
   */
  const handleStep1Next = (dsId: string, dsName: string) => {
    setDatasetId(dsId);
    setDatasetName(dsName);
    setStep(1);
  };

  /**
   * 处理第二步完成后的评测器结果
   * @param evId - 评测器 ID
   * @param evName - 评测器名称
   * @returns 无返回值
   */
  const handleStep2Next = (evId: string, evName: string, evVersionId: string) => {
    setEvaluatorId(evId);
    setEvaluatorName(evName);
    setEvaluatorVersionId(evVersionId);
    setStep(2);
  };

  /**
   * 完成向导并跳转到实验详情
   * @param experimentId - 实验 ID
   * @returns 无返回值
   */
  const handleComplete = (experimentId: string) => {
    navigate(`/evaluation?experimentId=${experimentId}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        <WizardStepIndicator currentStep={step} steps={steps} />

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
            evaluatorId={evaluatorId}
            evaluatorName={evaluatorName}
            evaluatorVersionId={evaluatorVersionId}
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
