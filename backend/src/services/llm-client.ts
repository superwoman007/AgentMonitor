export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs?: number;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * 通用 OpenAI-compatible HTTP 客户端
 * 支持原生 fetch，零依赖
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMResponse> {
  let baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  if (!baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  }
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1024,
  };

  const controller = new AbortController();
  const timeoutId = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : null;

  // 小米 MIMO 使用 api-key header，其他使用 Authorization: Bearer
  const isApiKeyHeader = baseUrl.includes('xiaomimimo');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (isApiKeyHeader) {
    headers['api-key'] = options.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: { content?: string };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const content = data.choices?.[0]?.message?.content || '';
  return { content, usage: data.usage };
}

/**
 * LLM Judge 评分 Prompt
 * 要求模型返回固定 JSON 格式
 */
export function buildJudgePrompt(
  output: string,
  expected: string,
  criteria: string
): LLMMessage[] {
  const systemPrompt = `You are an expert evaluator for AI agent outputs. Your task is to evaluate the quality of a given output against an expected answer.

You must respond with a valid JSON object in this exact format:
{
  "score": <number between 0 and 1>,
  "passed": <boolean>,
  "reasoning": <string explaining your evaluation>,
  "dimensions": {
    "accuracy": <number 0-1>,
    "helpfulness": <number 0-1>,
    "conciseness": <number 0-1>
  }
}

Rules:
- score: Overall quality score (0.0 = completely wrong, 1.0 = perfect)
- passed: true if score >= 0.6, false otherwise
- reasoning: Brief explanation of why you gave this score
- dimensions: Sub-scores for different quality aspects

Be objective and consistent in your evaluation.`;

  const criteriaHint = criteria && criteria !== 'general'
    ? `\nEvaluation focus: ${criteria}`
    : '';

  const userPrompt = `Expected Answer:\n${expected || '(no expected answer provided)'}\n\nActual Output:\n${output}${criteriaHint}\n\nPlease evaluate and return JSON only.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * 从 LLM 响应中安全提取 JSON
 */
export function extractJsonFromLLMResponse(text: string): Record<string, unknown> | null {
  // 尝试直接解析
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // 忽略
  }

  // 尝试从 markdown code block 中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // 忽略
    }
  }

  // 尝试从文本中提取第一个 { ... } 结构
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // 忽略
    }
  }

  return null;
}
