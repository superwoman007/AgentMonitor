
import AgentMonitorSimple from './simple.js';

const agentmonitor = AgentMonitorSimple.init({
  apiKey: 'demo-key-12345',
  baseUrl: 'http://localhost:3000',
});

console.log(' AgentMonitor Demo Started');
console.log('');

async function sendTrace() {
  const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'llama-2-70b'];
  const model = models[Math.floor(Math.random() * models.length)];
  const latencyMs = 500 + Math.random() * 1500;

  const response = {
    id: 'chatcmpl-' + Math.random().toString(36).substr(2, 9),
    content: 'This is a simulated response.',
    usage: {
      prompt_tokens: Math.floor(Math.random() * 200) + 50,
      completion_tokens: Math.floor(Math.random() * 300) + 100,
      total_tokens: 0,
    },
  };
  response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;

  await agentmonitor.traceLLM(
    model,
    { model, messages: [{ role: 'user', content: 'Hello' }] },
    response,
    Math.floor(latencyMs),
    true
  );

  console.log(' Sent trace: model=' + model + ', latency=' + Math.floor(latencyMs) + 'ms, tokens=' + response.usage.total_tokens);
}

async function runDemo() {
  console.log(' Sending initial traces...');
  for (let i = 0; i < 5; i++) {
    await sendTrace();
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('');
  console.log(' Sending continuous traces...');
  console.log(' Check dashboard at http://localhost:5173');
  console.log(' Press Ctrl+C to stop');
  console.log('');

  setInterval(async () => {
    await sendTrace();
  }, 2000);
}

runDemo().catch(console.error);
