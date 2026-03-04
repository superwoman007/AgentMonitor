#!/usr/bin/env node

/**
 * AgentMonitor SDK 快速测试脚本
 * 
 * 使用方法：
 * 1. 确保 AgentMonitor 服务运行中（前端 :5174 + 后端 :3000）
 * 2. 在面板中创建项目并获取 API Key
 * 3. 运行：AGENTMONITOR_API_KEY=your_key node quick-test.js
 */

const { AgentMonitor } = require('./dist/index.js');

const API_KEY = process.env.AGENTMONITOR_API_KEY;
const BASE_URL = process.env.AGENTMONITOR_URL || 'http://localhost:3000';

if (!API_KEY) {
  console.error('❌ 错误：未设置 AGENTMONITOR_API_KEY 环境变量');
  console.log('\n使用方法：');
  console.log('  AGENTMONITOR_API_KEY=your_key node quick-test.js');
  console.log('\n获取 API Key：');
  console.log('  1. 访问 http://localhost:5174');
  console.log('  2. 注册账号 → 创建项目');
  console.log('  3. Settings → 生成 API Key\n');
  process.exit(1);
}

console.log('🚀 AgentMonitor SDK 快速测试\n');
console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
console.log(`后端地址: ${BASE_URL}\n`);

// 初始化 SDK
const monitor = AgentMonitor.init({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
});

// 测试 1：简单函数包装
console.log('📝 测试 1: 函数包装');
const testFunction = monitor.wrap(async (name) => {
  await new Promise(resolve => setTimeout(resolve, 300));
  return `Hello, ${name}!`;
}, { name: 'test_function' });

// 测试 2：模拟 LLM 调用
console.log('📝 测试 2: LLM 调用追踪');
function testLLM() {
  const session = monitor.startSession({ test: 'quick-test' });
  
  monitor.trackMessage({
    sessionId: session.id,
    role: 'user',
    content: 'What is the weather today?',
  });
  
  monitor.traceLLM(
    'gpt-4',
    { messages: [{ role: 'user', content: 'What is the weather today?' }] },
    { choices: [{ message: { content: 'It is sunny!' } }] },
    250
  );
  
  monitor.trackMessage({
    sessionId: session.id,
    role: 'assistant',
    content: 'It is sunny!',
  });
  
  monitor.endSession(session.id);
}

// 测试 3：错误追踪
console.log('📝 测试 3: 错误追踪');
const errorFunction = monitor.wrap(async () => {
  throw new Error('Test error - this is expected');
}, { name: 'error_test' });

// 运行测试
async function runTests() {
  try {
    // 测试 1
    const result1 = await testFunction('World');
    console.log(`  ✅ 结果: ${result1}`);
    
    // 测试 2
    testLLM();
    console.log('  ✅ LLM 调用已追踪');
    
    // 测试 3
    try {
      await errorFunction();
    } catch (err) {
      console.log(`  ✅ 错误已捕获: ${err.message}`);
    }
    
    // 等待数据上报
    console.log('\n⏳ 等待数据上报...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 手动 flush
    await monitor.flush();
    
    console.log('\n✅ 测试完成！\n');
    console.log('📊 查看监控数据：');
    console.log('  Dashboard:  http://localhost:5174/dashboard');
    console.log('  Sessions:   http://localhost:5174/sessions');
    console.log('  Debugging:  http://localhost:5174/debugging');
    console.log('  Quality:    http://localhost:5174/quality\n');
    
    console.log('💡 提示：');
    console.log('  - 如果数据未显示，检查后端是否运行：curl http://localhost:3000/api/v1/stats');
    console.log('  - 查看后端日志：cd backend && tail -f logs/backend.log');
    console.log('  - 刷新浏览器页面\n');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.log('\n排查步骤：');
    console.log('  1. 检查后端是否运行：curl http://localhost:3000/api/v1/stats');
    console.log('  2. 检查 API Key 是否正确');
    console.log('  3. 查看后端日志\n');
  } finally {
    monitor.close();
  }
}

runTests();
