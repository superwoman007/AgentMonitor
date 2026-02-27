
// AgentMonitor OpenAI Demo - 1 行代码接入示例
// 演示如何在 OpenAI 调用中集成 AgentMonitor SDK

import AgentMonitorSimple from './src/simple.js';

// 1. 初始化 AgentMonitor（1 行代码）
const agentmonitor = AgentMonitorSimple.init({
  apiKey: 'demo-key-12345',
  baseUrl: 'http://localhost:3000',
});

console.log('🚀 AgentMonitor OpenAI Demo Started');
console.log('📡 SDK initialized with 1 line of code');
console.log('');

// 模拟 OpenAI 调用（示例，不用真的调用 OpenAI API）
async function simulateOpenAICall(model: string, messages: any[]) {
  const startTime = Date.now();

  try {
    console.log('🤖 Calling OpenAI...');
    console.log('   Model:', model);
    console.log('   Messages:', JSON.stringify(messages));
    console.log('');

    // 模拟网络延迟
    const latencyMs = 500 + Math.random() * 1500;
    await new Promise(resolve =&gt; setTimeout(resolve, latencyMs));

    // 模拟响应
    const response = {
      id: 'chatcmpl-' + Math.random().toString(36).substr(2, 9),
      content: '这是一个模拟的 OpenAI 响应。你问的是：' + messages[messages.length - 1].content,
      usage: {
        prompt_tokens: Math.floor(Math.random() * 200) + 50,
        completion_tokens: Math.floor(Math.random() * 300) + 100,
        total_tokens: 0,
      },
    };
    response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;

    const actualLatency = Date.now() - startTime;

    // 2. 追踪 LLM 调用（1 行代码）
    await agentmonitor.traceLLM(
      model,
      { model, messages, temperature: 0.7 },
      response,
      actualLatency,
      true
    );

    console.log('✅ OpenAI call completed');
    console.log('   Latency:', actualLatency + 'ms');
    console.log('   Tokens:', response.usage.total_tokens);
    console.log('   Response:', response.content.substring(0, 80) + '...');
    console.log('   📊 Trace sent to AgentMonitor');
    console.log('');

    return response;
  } catch (error) {
    const actualLatency = Date.now() - startTime;

    // 追踪错误
    await agentmonitor.traceLLM(
      model,
      { model, messages },
      {},
      actualLatency,
      false,
      error instanceof Error ? error.message : 'Unknown error'
    );

    console.error('❌ OpenAI call failed:', error);
    console.log('');
    throw error;
  }
}

// 运行演示
async function runDemo() {
  console.log('='.repeat(60));
  console.log('📋 Demo 1: Simple question');
  console.log('='.repeat(60));
  await simulateOpenAICall('gpt-4', [
    { role: 'user', content: '你好，请介绍一下你自己' },
  ]);

  await sleep(1000);

  console.log('='.repeat(60));
  console.log('📋 Demo 2: Coding question');
  console.log('='.repeat(60));
  await simulateOpenAICall('gpt-4', [
    { role: 'user', content: '写一个 Python 函数计算斐波那契数列' },
  ]);

  await sleep(1000);

  console.log('='.repeat(60));
  console.log('📋 Demo 3: Multi-turn conversation');
  console.log('='.repeat(60));
  await simulateOpenAICall('gpt-3.5-turbo', [
    { role: 'user', content: '什么是机器学习？' },
    { role: 'assistant', content: '机器学习是人工智能的一个分支...' },
    { role: 'user', content: '能举个例子吗？' },
  ]);

  await sleep(1000);

  console.log('='.repeat(60));
  console.log('🔄 Sending continuous requests for live demo...');
  console.log('   Check the dashboard at http://localhost:5173');
  console.log('   Press Ctrl+C to stop');
  console.log('='.repeat(60));
  console.log('');

  // 持续发送请求，演示实时效果
  const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'llama-2-70b'];
  const questions = [
    '你好',
    '今天天气怎么样？',
    '帮我写个代码',
    '解释一下量子计算',
    '推荐一本书',
    '翻译这句话',
    '写一封邮件',
    '生成一个图片描述',
  ];

  let counter = 0;
  setInterval(async () =&gt; {
    counter++;
    const model = models[Math.floor(Math.random() * models.length)];
    const question = questions[Math.floor(Math.random() * questions.length)] + ' #' + counter;

    try {
      await simulateOpenAICall(model, [
        { role: 'user', content: question },
      ]);
    } catch (err) {
      // ignore
    }
  }, 2500);
}

function sleep(ms: number) {
  return new Promise(resolve =&gt; setTimeout(resolve, ms));
}

runDemo().catch(console.error);
