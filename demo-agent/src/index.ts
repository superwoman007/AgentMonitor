// Demo Agent - 智能客服 AI
import dotenv from 'dotenv';
import { CustomerServiceAgent } from './agent.js';

dotenv.config();

const MONITOR_API_KEY =
  process.env.MONITOR_API_KEY ||
  process.env.AGENTMONITOR_API_KEY ||
  'demo-api-key';
const MONITOR_API_URL =
  process.env.MONITOR_API_URL ||
  process.env.AGENTMONITOR_BASE_URL ||
  'http://localhost:3000';

async function main() {
  console.log('🤖 Starting Demo Customer Service Agent...');
  console.log(`   AgentMonitor: ${MONITOR_API_URL}`);
  console.log('');

  const agent = new CustomerServiceAgent({
    monitorApiKey: MONITOR_API_KEY,
    monitorUrl: MONITOR_API_URL,
  });

  // 演示 1: 普通对话
  console.log('=== Demo 1: 普通对话 ===');
  await agent.handleUserMessage('你好，我想查一下我的订单');
  console.log('');

  // 演示 2: 查询天气（工具调用）
  console.log('=== Demo 2: 查询天气（工具调用） ===');
  await agent.handleUserMessage('北京今天天气怎么样？');
  console.log('');

  // 演示 3: 触发错误（展示断点调试）
  console.log('=== Demo 3: 故意触发错误（断点调试演示） ===');
  await agent.handleUserMessage('故意触发一个错误');
  console.log('');

  // 演示 4: 高延迟调用（展示延迟断点）
  console.log('=== Demo 4: 高延迟调用（延迟断点演示） ===');
  await agent.handleUserMessage('查一下深圳的天气，但我要你慢一点');
  console.log('');

  // 演示 5: LLM 调用（展示 Token 统计）
  console.log('=== Demo 5: LLM 调用（Token 统计演示） ===');
  await agent.handleUserMessage('我想了解一下你们的服务介绍');
  console.log('');

  await agent.endSession();
  console.log('');

  console.log('✅ Demo 完成！');
}

main().catch((error) => {
  console.error('❌ Demo 失败:', error);
  process.exit(1);
});
