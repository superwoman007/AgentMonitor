
// AgentMonitor SDK - Simplified MVP Version
// 最简版本 SDK，专为 2 天 MVP 准备

export interface AgentMonitorConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface LLMTrace {
  id: string;
  timestamp: string;
  model: string;
  request: {
    model: string;
    messages: any[];
    temperature?: number;
    max_tokens?: number;
  };
  response: {
    id: string;
    content: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };
  latencyMs: number;
  success: boolean;
  error?: string;
}

class AgentMonitorSimple {
  private config: AgentMonitorConfig;

  constructor(config: AgentMonitorConfig) {
    this.config = {
      baseUrl: 'http://localhost:3000',
      ...config,
    };
  }

  static init(config: AgentMonitorConfig) {
    return new AgentMonitorSimple(config);
  }

  async traceLLM(
    model: string,
    request: any,
    response: any,
    latencyMs: number,
    success: boolean,
    error?: string
  ): Promise&lt;void&gt; {
    const trace: LLMTrace = {
      id: 'trace_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      model,
      request,
      response,
      latencyMs,
      success,
      error,
    };

    try {
      await fetch(this.config.baseUrl + '/api/v1/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.config.apiKey,
        },
        body: JSON.stringify(trace),
      });
    } catch (err) {
      console.warn('[AgentMonitor] Failed to send trace:', err);
    }
  }
}

export default AgentMonitorSimple;
export { AgentMonitorSimple };
