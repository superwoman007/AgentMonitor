#!/bin/bash
set -e

echo "🧪 AgentMonitor 自动化测试套件"
echo "================================"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查服务是否运行
check_service() {
  local url=$1
  local name=$2
  
  if curl -s "$url" > /dev/null; then
    echo -e "${GREEN}✓${NC} $name 运行中"
    return 0
  else
    echo -e "${RED}✗${NC} $name 未运行"
    return 1
  fi
}

# 1. API 测试（后端）
echo ""
echo "📡 运行 API 测试..."
cd backend
npm run test:api
API_EXIT=$?

if [ $API_EXIT -eq 0 ]; then
  echo -e "${GREEN}✓ API 测试通过${NC}"
else
  echo -e "${RED}✗ API 测试失败${NC}"
fi

cd ..

# 2. UI 测试（前端）
echo ""
echo "🖥️  运行 UI 测试..."

# 检查前端服务
if ! check_service "http://localhost:5173" "前端服务"; then
  echo "启动前端服务..."
  cd frontend
  npm run dev &
  FRONTEND_PID=$!
  sleep 5
  cd ..
fi

cd frontend
npx playwright test --config=playwright.config.ts
UI_EXIT=$?

if [ $UI_EXIT -eq 0 ]; then
  echo -e "${GREEN}✓ UI 测试通过${NC}"
else
  echo -e "${RED}✗ UI 测试失败${NC}"
fi

cd ..

# 3. E2E 测试（场景）
echo ""
echo "🎬 运行 E2E 场景测试..."

# 检查后端服务
if ! check_service "http://localhost:3000/health" "后端服务"; then
  echo "启动后端服务..."
  cd backend
  npm run dev &
  BACKEND_PID=$!
  sleep 5
  cd ..
fi

npx playwright test --config=playwright.config.e2e.ts
E2E_EXIT=$?

if [ $E2E_EXIT -eq 0 ]; then
  echo -e "${GREEN}✓ E2E 测试通过${NC}"
else
  echo -e "${RED}✗ E2E 测试失败${NC}"
fi

# 清理后台进程
if [ ! -z "$FRONTEND_PID" ]; then
  kill $FRONTEND_PID 2>/dev/null || true
fi

if [ ! -z "$BACKEND_PID" ]; then
  kill $BACKEND_PID 2>/dev/null || true
fi

# 总结
echo ""
echo "================================"
echo "📊 测试结果汇总"
echo "================================"

if [ $API_EXIT -eq 0 ]; then
  echo -e "API 测试:  ${GREEN}✓ 通过${NC}"
else
  echo -e "API 测试:  ${RED}✗ 失败${NC}"
fi

if [ $UI_EXIT -eq 0 ]; then
  echo -e "UI 测试:   ${GREEN}✓ 通过${NC}"
else
  echo -e "UI 测试:   ${RED}✗ 失败${NC}"
fi

if [ $E2E_EXIT -eq 0 ]; then
  echo -e "E2E 测试:  ${GREEN}✓ 通过${NC}"
else
  echo -e "E2E 测试:  ${RED}✗ 失败${NC}"
fi

# 退出码
if [ $API_EXIT -eq 0 ] && [ $UI_EXIT -eq 0 ] && [ $E2E_EXIT -eq 0 ]; then
  echo ""
  echo -e "${GREEN}🎉 所有测试通过！${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}❌ 部��测试失败${NC}"
  exit 1
fi
