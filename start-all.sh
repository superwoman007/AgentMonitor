
#!/bin/bash
# 启动所有服务的脚本
echo "Starting AgentMonitor MVP Services..."

# 启动后端
echo "Starting backend on port 3000..."
cd backend
nohup node simple-server.js > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"
cd ..

# 等待后端启动
sleep 2

# 启动前端
echo "Starting frontend on port 5173..."
cd frontend
nohup npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"
cd ..

# 等待前端启动
sleep 2

# 启动 Demo
echo "Starting Demo to send test data..."
cd sdk
nohup node demo.js > ../logs/demo.log 2>&1 &
DEMO_PID=$!
echo "Demo PID: $DEMO_PID"
cd ..

echo ""
echo "========================================"
echo "All services started!"
echo "========================================"
echo "Backend:  http://localhost:3000"
echo "Frontend: http://localhost:5173"
echo "========================================"
echo "Logs in logs/ directory"
echo ""
