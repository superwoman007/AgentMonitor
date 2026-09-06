// 真实 Agent 接入补测：RAG / 知识库检索 Hook
// 模拟一个带 Retrieval 步骤的 Agent：会话 -> 知识库检索(withSpan) -> LLM 生成 -> 结束
import dotenv from 'dotenv';
import AgentMonitor from 'agentmonitor-sdk';

dotenv.config();

const apiKey = process.env.RAG_KEY!;
const baseUrl = process.env.RAG_URL || 'http://127.0.0.1:3300';

async function main() {
  const monitor = new AgentMonitor({ apiKey, baseUrl });

  const session = monitor.startSession();
  await monitor.trackMessage({ sessionId: session.id, role: 'user', content: '退款政策是什么？' });

  // 1. RAG 知识库检索（Retrieval Hook）
  const docs = await monitor.withSpan(
    'knowledge_base_search',
    async (span) => {
      // 模拟向量检索
      await new Promise((r) => setTimeout(r, 120));
      return [
        { title: '退款政策 v3', content: '支持 7 天无理由退款...', score: 0.94 },
        { title: 'VIP 服务条款', content: 'VIP 客户可享极速退款...', score: 0.81 },
      ];
    },
    {
      sessionId: session.id,
      input: { query: '退款政策', topK: 3 },
      attributes: { 'rag.engine': 'vector', 'rag.collection': 'policy_docs' },
    }
  );
  console.log('检索到文档:', docs.length, '篇');

  // 2. LLM 基于检索结果生成（LLM Hook + Token）
  await monitor.traceLLM(
    'rag-llm',
    { model: 'gpt-4', prompt: `根据以下资料回答：${JSON.stringify(docs)}` },
    { usage: { prompt_tokens: 86, completion_tokens: 42, total_tokens: 128 } },
    340,
    true
  );

  await monitor.trackMessage({ sessionId: session.id, role: 'assistant', content: '根据知识库，支持 7 天无理由退款，VIP 可极速处理。' });
  await monitor.endSession();
  await monitor.flush();
  monitor.close();
  console.log('RAG 场景上报完成');
}

main().catch((e) => {
  console.error('RAG 场景失败:', e);
  process.exit(1);
});
