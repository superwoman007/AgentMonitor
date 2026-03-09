// 智能客服 Agent 核心
import AgentMonitor from 'agentmonitor-sdk';
import { mockLLM, checkWeather, getOrderStatus, slowOrderCheck } from './tools.js';

export class CustomerServiceAgent {
  private monitor: AgentMonitor;
  private sessionId: string = '';

  constructor(config: { monitorApiKey: string; monitorUrl?: string }) {
    this.monitor = new AgentMonitor({
      apiKey: config.monitorApiKey,
      baseUrl: config.monitorUrl || 'http://localhost:3000',
    });
  }

  async handleUserMessage(userInput: string): Promise<void> {
    // 开始或继续会话
    if (!this.sessionId) {
      const session = this.monitor.startSession();
      this.sessionId = session.id;
    }

    // 记录用户消息
    this.monitor.trackMessage({
      sessionId: this.sessionId,
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString(),
    });

    // 意图识别（简单规则）
    const intent = this.detectIntent(userInput);

    let response = '';
    let toolCall: any = null;

    try {
      if (intent === 'weather') {
        const city = this.extractCity(userInput);
        const wrapped = this.monitor.wrap(async () => {
          return await checkWeather(city);
        }, { name: 'checkWeather', sessionId: this.sessionId });
        toolCall = await wrapped();
        
        response = `好的，已为您查询${city}的天气。${JSON.stringify(toolCall)}`;
      } else if (intent === 'order') {
        const wrapped = this.monitor.wrap(async () => {
          return await getOrderStatus();
        }, { name: 'getOrderStatus', sessionId: this.sessionId });
        toolCall = await wrapped();
        
        response = `您的订单状态：${toolCall}`;
      } else if (intent === 'error') {
        // 故意触发错误，展示断点调试
        const wrapped = this.monitor.wrap(async () => {
          throw new Error('故意触发的错误，用于演示断点调试功能');
        }, { name: 'failingTool', sessionId: this.sessionId });
        toolCall = await wrapped();
        
        response = '抱歉，发生了错误';
      } else if (intent === 'slow') {
        // 慢查询，展示延迟断点
        const wrapped = this.monitor.wrap(async () => {
          return await slowOrderCheck();
        }, { name: 'slowOrderCheck', sessionId: this.sessionId });
        toolCall = await wrapped();
        
        response = `您的订单状态（慢查询）：${toolCall}`;
      } else if (intent === 'decision') {
        const decisionData = {
          projectId: 'auto',
          sessionId: this.sessionId,
          decisionType: 'refund_strategy',
          selectedOption: 'full_refund',
          confidence: 0.95,
          reasoning: '用户为VIP且投诉理由合理，符合全额退款策略',
          decisionMaker: 'rule',
          latencyMs: 50,
          options: [
            { name: 'full_refund', score: 0.95, pros: ['用户满意度高', '符合VIP政策'], cons: ['成本高'] },
            { name: 'partial_refund', score: 0.60, pros: ['成本可控'], cons: ['用户可能流失'] },
            { name: 'reject', score: 0.10, pros: ['无直接成本'], cons: ['极高投诉风险'] }
          ]
        };
        
        await this.monitor.trackDecision(decisionData);
        response = `已根据规则做出决策：全额退款 (置信度 95%)`;
      } else {
        const startTime = Date.now();
        const llmText = await mockLLM(userInput);
        const latencyMs = Date.now() - startTime;
        const promptTokens = this.estimateTokens(userInput);
        const completionTokens = this.estimateTokens(llmText);
        await this.monitor.traceLLM(
          'mock-llm',
          { model: 'mock-llm', prompt: userInput },
          { usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } },
          latencyMs,
          true
        );
        response = llmText;
      }

      // 记录助手回复
      this.monitor.trackMessage({
        sessionId: this.sessionId,
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
      });

      console.log(`👤 Agent: ${response}`);

    } catch (error) {
      console.error('❌ Error:', error);
      this.monitor.trackMessage({
        sessionId: this.sessionId,
        role: 'assistant',
        content: `Sorry, something went wrong: ${error}`,
        timestamp: new Date().toISOString(),
        metadata: { error: String(error) },
      });
    }
  }

  private estimateTokens(text: string): number {
    const normalized = text?.trim() || '';
    if (!normalized) return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  private detectIntent(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('天气') || lower.includes('weather')) {
      return 'weather';
    }
    if (lower.includes('订单') || lower.includes('order')) {
      if (lower.includes('慢') || lower.includes('slow')) {
        return 'slow';
      }
      return 'order';
    }
    if (lower.includes('错误') || lower.includes('error') || lower.includes('触发')) {
      return 'error';
    }
    if (lower.includes('决策') || lower.includes('decision') || lower.includes('方案')) {
      return 'decision';
    }
    return 'chat';
  }

  private extractCity(message: string): string {
    // 简单的城市提取
    const cities = ['北京', '上海', '深圳', '广州', '杭州', 'Beijing', 'Shanghai', 'Shenzhen'];
    for (const city of cities) {
      if (message.includes(city)) {
        return city;
      }
    }
    return '北京'; // 默认
  }

  async endSession(): Promise<void> {
    if (this.sessionId) {
      await this.monitor.endSession(this.sessionId);
      this.monitor.close();
      this.sessionId = '';
      console.log('✅ Session ended');
    }
  }
}
