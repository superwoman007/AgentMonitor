# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]:
    - generic [ref=e7]:
      - heading "AgentMonitor" [level=1] [ref=e8]
      - heading "创建新账号" [level=2] [ref=e9]
    - button "EN" [ref=e10] [cursor=pointer]
  - generic [ref=e11]:
    - generic [ref=e12]:
      - generic [ref=e13]: 姓名 (邮箱)
      - textbox "John Doe" [ref=e14]
    - generic [ref=e15]:
      - generic [ref=e16]: 邮箱
      - textbox "user@example.com" [ref=e17]: test-ui-1772387361698@example.com
    - generic [ref=e18]:
      - generic [ref=e19]: 密码
      - textbox "••••••••" [active] [ref=e20]: Test123456!
    - generic [ref=e21]:
      - generic [ref=e22]: 确认密码
      - textbox "••••••••" [ref=e23]
    - button "注册" [ref=e24] [cursor=pointer]
  - paragraph [ref=e25]:
    - text: 已有账号？
    - link "登录" [ref=e26] [cursor=pointer]:
      - /url: /login
```