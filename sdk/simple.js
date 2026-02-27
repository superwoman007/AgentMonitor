
// AgentMonitor SDK - Simplified MVP Version - JavaScript
// 最简版本 SDK，专为 2 天 MVP 准备，纯 JS 不搞 TypeScript

class AgentMonitorSimple {
  constructor(config) {
    this.config = {
      baseUrl: 'http://localhost:3000',
      ...config,
    };
  }

  static init(config) {
    return new AgentMonitorSimple(config);
  }

  async traceLLM(model, request, response, latencyMs, success, error) {
    const trace = {
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
