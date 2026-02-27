
import { AgentMonitor } from './src/index.js';

const agentmonitor = AgentMonitor.init({
  apiKey: 'demo-key-12345',
  baseUrl: 'http://localhost:3000',
  disabled: false,
  flushInterval: 1000,
});

console.log('🚀 AgentMonitor SDK Demo Started');
console.log('📡 Sending events to http://localhost:3000');
console.log('');

async function runDemo() {
  console.log('📞 Starting session...');
  const session = agentmonitor.startSession();
  console.log('   Session ID:', session.id);
  console.log('');

  await sleep(500);
  console.log('💬 Sending messages...');

  agentmonitor.trackMessage({
    sessionId: session.id,
    role: 'user',
    content: 'Hello, please write a Python function to calculate Fibonacci',
    timestamp: new Date().toISOString(),
  });

  await sleep(300);

  agentmonitor.trackMessage({
    sessionId: session.id,
    role: 'assistant',
    content: 'Sure, let me help you with that. First, let me call the code executor...',
    timestamp: new Date().toISOString(),
  });

  await sleep(200);
  console.log('🔧 Simulating tool call...');

  agentmonitor.trackToolCall({
    id: 'tool_call_001',
    sessionId: session.id,
    toolName: 'python_executor',
    inputParams: {
      code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\n\nprint(fib(10))',
    },
    startedAt: new Date().toISOString(),
  });

  await sleep(800);

  agentmonitor.trackToolCall({
    id: 'tool_call_001',
    sessionId: session.id,
    toolName: 'python_executor',
    inputParams: {
      code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\n\nprint(fib(10))',
    },
    output: { result: 55 },
    latencyMs: 750,
    startedAt: new Date(Date.now() - 800).toISOString(),
    endedAt: new Date().toISOString(),
  });

  agentmonitor.trackMessage({
    sessionId: session.id,
    role: 'assistant',
    content: 'Done! The 10th Fibonacci number is 55.',
    timestamp: new Date().toISOString(),
  });

  console.log('');

  await sleep(500);
  console.log('🔚 Ending session...');
  await agentmonitor.endSession(session.id);

  console.log('');
  console.log('✅ Demo completed!');
  console.log('');
  console.log('📊 Check the dashboard at http://localhost:5173');
  console.log('');

  console.log('🔄 Sending more events in background for live demo...');
  console.log('   Press Ctrl+C to stop');
  console.log('');

  let counter = 0;
  setInterval(async () => {
    counter++;
    const session2 = agentmonitor.startSession('auto_session_' + counter);

    await sleep(200);
    agentmonitor.trackMessage({
      sessionId: session2.id,
      role: 'user',
      content: 'Test message ' + counter,
      timestamp: new Date().toISOString(),
    });

    await sleep(300);
    agentmonitor.trackMessage({
      sessionId: session2.id,
      role: 'assistant',
      content: 'This is auto reply ' + counter,
      timestamp: new Date().toISOString(),
    });

    await sleep(200);
    await agentmonitor.endSession(session2.id);

    console.log('✅ Auto-sent session', counter);
  }, 3000);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runDemo().catch(console.error);
