interface EvalOptions {
  baseUrl: string;
  apiKey: string;
  datasetId: string;
  promptId: string;
}

interface EvalResult {
  exitCode: number;
  passed: number;
  failed: number;
  details?: unknown;
}

export async function runEval(options: EvalOptions): Promise<EvalResult> {
  const response = await fetch(`${options.baseUrl}/api/v1/evaluation/experiments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      project_id: 'default',
      dataset_id: options.datasetId,
      prompt_id: options.promptId,
      name: `CLI Eval ${new Date().toISOString()}`,
    }),
  });

  if (!response.ok) {
    return { exitCode: 1, passed: 0, failed: 0 };
  }

  const data = await response.json() as { passed?: number; failed?: number };
  const passed = data.passed || 0;
  const failed = data.failed || 0;

  return {
    exitCode: failed === 0 ? 0 : 1,
    passed,
    failed,
    details: data,
  };
}
