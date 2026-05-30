interface WizardStepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export function WizardStepIndicator({ currentStep, steps }: WizardStepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((label, idx) => {
        const isActive = idx === currentStep;
        const isCompleted = idx < currentStep;
        return (
          <div key={idx} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 ${isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                isActive ? 'border-blue-600 bg-blue-50' : isCompleted ? 'border-green-600 bg-green-50' : 'border-gray-300'
              }`}>
                {isCompleted ? '✓' : idx + 1}
              </div>
              <span className="text-sm font-medium">{label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-8 h-0.5 ${isCompleted ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
