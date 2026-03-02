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
      timestamp: new Date(),
    });

    // 意图识别（简单规则）
    const intent = this.detectIntent(userInput);

    let response = '';
    let toolCall: any = null;

    try {
      if (intent === 'weather') {
        const city = this.extractCity(userInput);
        toolCall = await this.monitor.wrap(async () => {
          return await checkWeather(city);
        }, { name: 'checkWeather', sessionId: this.sessionId });
        
        response = `好的，已为您查询${city}的天气。${toolCall.result}`;
      } else if (intent === 'order') {
        toolCall = await this.monitor.wrap(async () => {
          return await getOrderStatus();
        }, { name: 'getOrderStatus', sessionId: this.sessionId });
        
        response = `您的订单状态：${toolCall.result}`;
      } else if (intent === 'error') {
        // 故意触发错误，展示断点调试
        toolCall = await this.monitor.wrap(async () => {
          throw new Error('故意触发的错误，用于演示断点调试功能');
        }, { name: 'failingTool', sessionId: this.sessionId });
        
        response = '抱歉，发生了错误';
      } else if (intent === 'slow') {
        // 慢查询，展示延迟断点
        toolCall = await this.monitor.wrap(async () => {
          return await slowOrderCheck();
        }, { name: 'slowOrderCheck', sessionId: this.sessionId });
        
        response = `您的订单状态（慢查询）：${toolCall.result}`;
      } else {
        // 普通 LLM 调用
        response = await this.monitor.wrap(async () => {
          return await mockLLM(userInput);
        }, { name: 'llm_response', sessionId: this.sessionId }) as string;
      }

      // 记录助手回复
      this.monitor.trackMessage({
        sessionId: this.sessionId,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });

      console.log(`👤 Agent: ${response}`);

    } catch (error) {
      console.error('❌ Error:', error);
      this.monitor.trackMessage({
        sessionId: this.sessionId,
        role: 'assistant',
        content: `Sorry, something went wrong: ${error}`,
        timestamp: new Date(),
        metadata: { error: String(error) },
      });
    }
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
      console.log('✅ Session ended');
    }
  }
}
