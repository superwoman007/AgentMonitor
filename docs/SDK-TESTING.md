# SDK 测试指南

> 如何测试 AgentMonitor SDK 的效果

## 方式 1：使用内置 Demo（最快）

### TypeScript/JavaScript Demo

```bash
cd sdk

# 1. 安装依赖
npm install

# 2. 配置 API Key
export AGENTMONITOR_API_KEY="your_project_id_your_api_key"

# 3. 运行基础 demo
npx tsx demo.js

# 4. 运行 OpenAI demo（需要 OpenAI API Key）
export OPENAI_API_KEY="sk-..."
npx tsx demo-openai.ts
```

### Python Demo

```bash
cd sdk-python

# 1. 安装 SDK
pip install -e .

# 2. 创建测试脚本
cat > test_demo.py << 'EOF'
from agentmonitor import AgentMonitor, SDKConfig
import time
import os

# 初始化
monitor = AgentMonitor.init(SDKConfig(
    api_key=os.getenv('AGENTMONITOR_API_KEY'),
    base_url='http://localhost:3000',
))

# 测试 1：简单函数包装
@monitor.wrap
def hello_agent(name: str):
    time.sleep(0.5)  # 模拟处理
    return f"Hello, {name}!"

# 测试 2：模拟 LLM 调用
def test_llm():
    session = monitor.start_session(metadata={'test': 'demo'})
    
    # 模拟 LLM 调用
    monitor.trace_llm(
        model='gpt-4',
        request={'prompt': 'Hello'},
        response={'text': 'Hi there!'},
        latency_ms=250,
        success=True,
    )
    
    monitor.end_session(session.id)

# 运行测试
print("测试 1: 函数包装")
result = hello_agent("World")
print(f"结果: {result}")

print("\n测试 2: LLM 调用追踪")
test_llm()

print("\n✅ 测试完成！访问 http://localhost:5174 查看数据")
monitor.close()
EOF

# 3. 运行
export AGENTMONITOR_API_KEY="your_api_key"
python test_demo.py
```

### Go Demo

```bash
cd sdk-go

# 1. 创建测试文件
cat > examples/basic/main.go << 'EOF'
package main

import (
    "fmt"
    "os"
    "time"
    
    "github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor"
)

func main() {
    monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
        APIKey:  os.Getenv("AGENTMONITOR_API_KEY"),
        BaseURL: "http://localhost:3000",
    })
    defer monitor.Close()
    
    // 测试 1：函数包装
    fmt.Println("测试 1: 函数包装")
    result, err := monitor.Wrap(func() (interface{}, error) {
        time.Sleep(500 * time.Millisecond)
        return "Hello, World!", nil
    }, "hello_agent", "")
    
    if err != nil {
        panic(err)
    }
    fmt.Printf("结果: %v\n", result)
    
    // 测试 2：LLM 调用追踪
    fmt.Println("\n测试 2: LLM 调用追踪")
    session := monitor.StartSession("", map[string]interface{}{
        "test": "demo",
    })
    
    monitor.TraceLLM(
        "gpt-4",
        map[string]interface{}{"prompt": "Hello"},
        map[string]interface{}{"text": "Hi there!"},
        250,
        true,
        "",
    )
    
    monitor.EndSession(session.ID)
    
    fmt.Println("\n✅ 测试完成！访问 http://localhost:5174 查看数据")
}
EOF

# 2. 运行
export AGENTMONITOR_API_KEY="your_api_key"
go run examples/basic/main.go
```

---

## 方式 2：创建自己的测试项目

### 1. 启动 AgentMonitor 服务

```bash
# 终端 1：启动后端
cd backend
npm run dev

# 终端 2：启动前端
cd frontend
npm run dev
```

访问 http://localhost:5174：
1. 注册账号
2. 创建项目
3. 生成 API Key（复制保存）

### 2. 创建测试项目

#### TypeScript 测试项目

```bash
mkdir test-agentmonitor
cd test-agentmonitor
npm init -y
npm install @agentmonitor/sdk tsx

# 创建测试文件
cat > test.ts << 'EOF'
import { AgentMonitor } from '@agentmonitor/sdk';

const monitor = AgentMonitor.init({
  apiKey: process.env.AGENTMONITOR_API_KEY!,
  baseUrl: 'http://localhost:3000',
});

// 测试函数
const testAgent = monitor.wrap(async (input: string) => {
  console.log(`处理输入: ${input}`);
  
  // 模拟一些处理
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return `处理结果: ${input.toUpperCase()}`;
}, { name: 'test_agent' });

// 运行测试
async function main() {
  console.log('开始测试...\n');
  
  // 测试 1
  const result1 = await testAgent('hello');
  console.log(result1);
  
  // 测试 2
  const result2 = await testAgent('world');
  console.log(result2);
  
  // 等待数据上报
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n✅ 测试完成！');
  console.log('访问 http://localhost:5174 查看监控数据');
  
  monitor.close();
}

main();
EOF

# 运行
export AGENTMONITOR_API_KEY="your_api_key"
npx tsx test.ts
```

#### Python 测试项目

```bash
mkdir test-agentmonitor
cd test-agentmonitor
pip install agentmonitor

# 创建测试文件
cat > test.py << 'EOF'
from agentmonitor import AgentMonitor, SDKConfig
import time
import os

monitor = AgentMonitor.init(SDKConfig(
    api_key=os.getenv('AGENTMONITOR_API_KEY'),
    base_url='http://localhost:3000',
))

# 测试函数
@monitor.wrap
def test_agent(input_text: str):
    print(f"处理输入: {input_text}")
    time.sleep(0.5)  # 模拟处理
    return f"处理结果: {input_text.upper()}"

# 运行测试
print("开始测试...\n")

result1 = test_agent('hello')
print(result1)

result2 = test_agent('world')
print(result2)

# 等待数据上报
time.sleep(1)

print("\n✅ 测试完成！")
print("访问 http://localhost:5174 查看监控数据")

monitor.close()
EOF

# 运行
export AGENTMONITOR_API_KEY="your_api_key"
python test.py
```

---

## 方式 3：压力测试（测试采样和性能）

```typescript
// stress-test.ts
import { AgentMonitor } from '@agentmonitor/sdk';

const monitor = AgentMonitor.init({
  apiKey: process.env.AGENTMONITOR_API_KEY!,
  baseUrl: 'http://localhost:3000',
  sampleRate: 0.1,  // 采样 10%
});

const agent = monitor.wrap(async (id: number) => {
  await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
  
  // 10% 概率报错
  if (Math.random() < 0.1) {
    throw new Error(`Error in task ${id}`);
  }
  
  return `Task ${id} completed`;
}, { name: 'stress_test_agent' });

async function stressTest() {
  console.log('开始压力测试：1000 次调用...\n');
  
  const promises = [];
  for (let i = 0; i < 1000; i++) {
    promises.push(
      agent(i).catch(err => console.log(`Task ${i} failed`))
    );
  }
  
  await Promise.all(promises);
  
  // 等待数据上报
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n✅ 压力测试完成！');
  console.log('预期上报约 100 条 trace（采样率 10%）');
  console.log('错误 trace 应该全部上报（alwaysCapture）');
  
  monitor.close();
}

stressTest();
```

运行：
```bash
npx tsx stress-test.ts
```

---

## 验证效果

### 1. 查看 Dashboard

访问 http://localhost:5174/dashboard

应该看到：
- ✅ 总请求数增加
- ✅ 成功率统计
- ✅ 平均延迟
- ✅ 实时更新（WebSocket）

### 2. 查看 Sessions

访问 http://localhost:5174/sessions

应该看到：
- ✅ 会话列表
- ✅ 每个会话的详细信息
- ✅ 时间轴回放

### 3. 查看 Debugging

访问 http://localhost:5174/debugging

测试断点功能：
1. 创建断点（类型：关键词，条件：ERROR）
2. 运行包含 "ERROR" 的测试
3. 查看 Snapshots 标签，应该看到快照

### 4. 查看 Quality

访问 http://localhost:5174/quality

应该看到：
- ✅ 质量评分
- ✅ 速度评分
- ✅ 成功率评分

---

## 测试清单

- [ ] SDK 能正常初始化
- [ ] 函数包装能追踪执行
- [ ] LLM 调用能正确上报
- [ ] Session 管理正常工作
- [ ] 错误能被捕获和上报
- [ ] Dashboard 实时更新
- [ ] 断点调试能触发
- [ ] 采样机制生效（sampleRate < 1 时）
- [ ] 错误总是上报（alwaysCapture）
- [ ] 数据持久化（重启后数据不丢失）

---

## 常见问题

### Q: 数据没有显示？

**排查步骤：**
1. 检查后端是否运行：`curl http://localhost:3000/api/v1/stats`
2. 检查 API Key 是否正确
3. 检查浏览器控制台是否有错误
4. 检查后端日志：`cd backend && tail -f logs/backend.log`

### Q: 数据延迟显示？

**A:** SDK 默认 5 秒批量上报，可以手动 flush：
```typescript
monitor.flush();  // 立即上报
```

### Q: 如何测试断点调试？

**A:** 
1. 在面板创建断点（关键词：ERROR）
2. 运行包含 "ERROR" 的代码
3. 查看 Debugging → Snapshots

### Q: 压力测试会影响性能吗？

**A:** 设置 `sampleRate=0.1` 只上报 10%，影响极小。

---

## 下一步

测试通过后，可以：
1. 集成到你的实际 Agent 项目
2. 部署到生产环境（参考 [部署指南](./DEPLOYMENT.md)）
3. 配置告警规则
4. 优化 Prompt 和成本

Happy monitoring! 🚀
