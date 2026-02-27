
// AgentMonitor OpenAI Demo - JavaScript 版本
// 1 行代码接入示例，纯 JS 不搞 TypeScript，立刻跑通！

import AgentMonitorSimple from './simple.js';

// 1. 初始化 AgentMonitor（1 行代码）
const agentmonitor = AgentMonitorSimple.init({
  apiKey: 'demo-key-12345',
  baseUrl: 'http://localhost:3000',
});

console.log(' AgentMonitor OpenAI Demo Started');
console.log(' SDK initialized with 1 line of code');
console.log('');

async function simulateOpenAICall(model, messages) {
  const startTime = Date.now();

  try {
    console.log(' Calling OpenAI...');
    console.log('   Model:', model);
    console.log('   Messages:', JSON.stringify(messages));
    console.log('');

    const latencyMs = 500 + Math.random() * 1500;
    await new Promise(resolve =&gt; setTimeout(resolve, latencyMs));

    const response = {
      id: 'chatcmpl-' + Math.random().toString(36).substr(2, 9),
      content: 'This is a simulated OpenAI response. You asked: ' + messages[messages.length - 1].content,
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

    console.log(' OpenAI call completed');
    console.log('   Latency:', actualLatency + 'ms');
    console.log('   Tokens:', response.usage.total_tokens);
    console.log('   Response:', response.content.substring(0, 80) + '...');
    console.log('    Trace sent to AgentMonitor');
    console.log('');

    return response;
  } catch (error) {
    const actualLatency = Date.now() - startTime;

    await agentmonitor.traceLLM(
      model,
      { model, messages },
      {},
      actualLatency,
      false,
      error instanceof Error ? error.message : 'Unknown error'
    );

    console.error(' OpenAI call failed:', error);
    console.log('');
    throw error;
  }
}

async function runDemo() {
  console.log('='.repeat(60));
  console.log(' Demo 1: Simple question');
  console.log('='.repeat(60));
  await simulateOpenAICall('gpt-4', [
    { role: 'user', content: 'Hello, please introduce yourself' },
  ]);

  await sleep(1000);

  console.log('='.repeat(60));
  console.log(' Demo 2: Coding question');
  console.log('='.repeat(60));
  await simulateOpenAICall('gpt-4', [
    { role: 'user', content: 'Write a Python function to calculate Fibonacci' },
  ]);

  await sleep(1000);

  console.log('='.repeat(60));
  console.log(' Demo 3: Multi-turn conversation');
  console.log('='.repeat(60));
  await simulateOpenAICall('gpt-3.5-turbo', [
    { role: 'user', content: 'What is machine learning?' },
    { role: 'assistant', content: 'Machine learning is a branch of AI...' },
    { role: 'user', content: 'Can you give an example?' },
  ]);

  await sleep(1000);

  console.log('='.repeat(60));
  console.log(' Sending continuous requests for live demo...');
  console.log('   Check the dashboard at http://localhost:5173');
  console.log('   Press Ctrl+C to stop');
  console.log('='.repeat(60));
  console.log('');

  const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'llama-2-70b'];
  const questions = [
    'Hello',
    'What is the weather today?',
    'Help me write code',
    'Explain quantum computing',
    'Recommend a book',
    'Translate this sentence',
    'Write an email',
    'Generate an image description',
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

function sleep(ms) {
  return new Promise(resolve =&gt; setTimeout(resolve, ms));
}

runDemo().catch(console.error);
