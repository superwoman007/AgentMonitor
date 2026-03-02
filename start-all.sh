#!/bin/bash
# AgentMonitor - 一键启动脚本
set -e

echo "🚀 Starting AgentMonitor..."

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. 启动 PostgreSQL Docker
echo -e "${YELLOW}[1/4] Starting PostgreSQL...${NC}"
if docker ps | grep -q agentmonitor-postgres; then
  echo "  PostgreSQL already running"
else
  docker run -d \
    --name agentmonitor-postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=agentmonitor \
    -p 5432:5432 \
    -v agentmonitor-pgdata:/var/lib/postgresql/data \
    postgres:15 2>/dev/null || docker start agentmonitor-postgres
  echo "  PostgreSQL started"
fi

# 2. 等待 PG 就绪
echo -e "${YELLOW}[2/4] Waiting for PostgreSQL...${NC}"
for i in $(seq 1 30); do
  if docker exec agentmonitor-postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo "  PostgreSQL is ready"
    break
  fi
  sleep 1
  if [ $i -eq 30 ]; then
    echo "  Error: PostgreSQL failed to start"
    exit 1
  fi
done

# 3. 启动后端
echo -e "${YELLOW}[3/4] Starting backend on port 3000...${NC}"
mkdir -p logs
cd backend
nohup npm run dev > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"
cd ..

# 等待后端启动
sleep 3

# 4. 启动前端
echo -e "${YELLOW}[4/4] Starting frontend on port 5174...${NC}"
cd frontend
nohup npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"
cd ..

sleep 2

echo ""
echo -e "${GREEN}========================================"
echo "✅ All services started!"
echo "========================================"
echo "Frontend:   http://localhost:5174"
echo "Backend:    http://localhost:3000"
echo "PostgreSQL: localhost:5432"
echo "========================================${NC}"
echo ""
echo "Logs: logs/backend.log, logs/frontend.log"
echo "Stop: docker stop agentmonitor-postgres && kill $BACKEND_PID $FRONTEND_PID"
