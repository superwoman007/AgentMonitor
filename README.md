
# AgentMonitor 🚀

**AI Agent 质量监控平台 - 让你的 AI 应用调用一目了然！**

[![GitHub stars](https://img.shields.io/github/stars/your-username/agent-monitor?style=social)](https://github.com/your-username/agent-monitor/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/your-username/agent-monitor?style=social)](https://github.com/your-username/agent-monitor/network/members)
[![GitHub license](https://img.shields.io/github/license/your-username/agent-monitor)](https://github.com/your-username/agent-monitor/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/your-username/agent-monitor)](https://github.com/your-username/agent-monitor/issues)

---

## ✨ 为什么用 AgentMonitor？

你是不是也在开发 AI 应用，但：

- 😫 不知道用户调用了多少次 AI？
- 😰 搞不清每次调用花了多少钱、多少 Token？
- 🤯 出错了找不到原因？
- 😓 想优化提示词但没数据支撑？

**AgentMonitor 来救你了！** 轻量级、开箱即用的 AI 调用监控面板，5分钟接入，实时监控所有 AI 调用！

---

## 🚀 快速开始

### 1. 一键启动

```bash
git clone https://github.com/your-username/agent-monitor.git
cd agent-monitor
./start-all.sh
```

### 2. 访问面板

打开浏览器访问：http://localhost:5173

### 3. 集成 SDK（仅需 3 行代码！）

```javascript
import AgentMonitor from './sdk/simple.js';

const monitor = new AgentMonitor('http://localhost:3000');

const result = await monitor.wrap(async () => {
  // 这里是你原本的 OpenAI/Anthropic 调用代码
  return await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }]
  });
});
```

搞定！所有调用自动上报，前端实时更新！

---

## 🎯 当前功能

- ✅ **实时监控面板** - 5个关键指标一目了然
  - 总请求数
  - 成功数/失败数
  - 成功率
  - 平均延迟
  - 总 Token 消耗

- ✅ **调用记录列表** - 所有调用按时间倒序排列
- ✅ **详细查看** - 点击任意记录查看完整请求/响应
- ✅ **实时 WebSocket** - 新调用自动推送，无需刷新
- ✅ **中英文切换** - 一键切换中文/英文界面
- ✅ **状态指示** - 连接/重连/断开状态实时显示

---

## 📸 截图

（放一张好看的截图）

---

## 🛠️ 技术栈

| 层级 | 选型 |
|------|------|
| **前端** | React + TailwindCSS + Vite |
| **后端** | Node.js + Express + WebSocket |
| **部署** | Docker + Nginx |

---

## 🚧 后续功能

- [ ] **告警系统** - 失败率过高、延迟过高自动告警
- [ ] **多项目支持** - 一个面板监控多个 AI 应用
- [ ] **成本分析** - 按模型、按时间、按用户的成本统计
- [ ] **提示词优化建议** - AI 自动分析并给出优化建议
- [ ] **导出功能** - 导出调用记录为 CSV/JSON
- [ ] **用户权限** - 多用户登录、权限管理
- [ ] **与 PromptHub 集成** - 一键导入提示词测试

---

## 📝 详细文档

见 [USAGE.md](./USAGE.md)

---

## 🤝 贡献

欢迎 Issue 和 PR！有问题随时提！

---

## 📄 许可证

MIT License - 见 [LICENSE](./LICENSE)

---

**如果这个项目帮到你，请给个 ⭐ Star！这是对我最大的支持！**
