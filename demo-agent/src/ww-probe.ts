import { AgentMonitor } from "/Users/lvjianqing/AI_Werewolf_Game_Website/api/lib/agentMonitorSdk.ts"

async function main() {
  const apiKey = process.env.WW_KEY!
  const monitor = AgentMonitor.init({ apiKey, baseUrl: "http://localhost:8080", apiPrefix: "/api/v1" })
  const sessionId = `game:sdk-probe:seat:1:werewolf`

  console.log("=== 1. ensureSession ===")
  try {
    await monitor.ensureSession(sessionId, { probe: true })
    console.log("ensureSession OK")
  } catch (e) {
    console.log("ensureSession FAIL:", (e as Error).message)
  }

  console.log("=== 2. trackMessage ===")
  try {
    await monitor.trackMessage({ sessionId, role: "system", content: "你是狼人" })
    console.log("trackMessage OK")
  } catch (e) {
    console.log("trackMessage FAIL:", (e as Error).message)
  }

  console.log("=== 3. traceLLM ===")
  try {
    await monitor.traceLLM(
      "mock",
      { model: "mock", messages: [{ role: "user", content: "hi" }] },
      { choices: [{ message: { content: "mock response" } }], usage: { total_tokens: 5 } },
      12,
      true,
      undefined,
      { sessionId, agentId: "probe-agent" },
    )
    console.log("traceLLM OK")
  } catch (e) {
    console.log("traceLLM FAIL:", (e as Error).message)
  }

  console.log("=== 4. trackDecision ===")
  try {
    await monitor.trackDecision({
      sessionId,
      decisionType: "vote",
      selectedOption: "投票给 2 号",
      decisionMaker: "llm",
      confidence: 0.8,
    })
    console.log("trackDecision OK")
  } catch (e) {
    console.log("trackDecision FAIL:", (e as Error).message)
  }

  console.log("=== 5. trackToolCall ===")
  try {
    await monitor.trackToolCall({ sessionId, toolName: "recall_speech", inputParams: { seat: 2 }, output: { ok: true }, latencyMs: 8 })
    console.log("trackToolCall OK")
  } catch (e) {
    console.log("trackToolCall FAIL:", (e as Error).message)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
