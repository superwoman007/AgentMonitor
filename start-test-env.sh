#!/bin/bash
# AgentMonitor - 测试环境启动脚本（无Docker版本）
set -e

echo "🚀 Starting AgentMonitor Test Environment..."

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 清理函数
cleanup_ports() {
    echo -e "${YELLOW}Cleaning up existing processes on ports 3000 and 5174...${NC}"
    
    # Kill processes on port 3000
    local pid_3000=$(lsof -t -i:3000 2>/dev/null || true)
    if [ -n "$pid_3000" ]; then
        echo "Killing process on port 3000: $pid_3000"
        kill -9 $pid_3000 2>/dev/null || true
    fi
    
    # Kill processes on port 5174
    local pid_5174=$(lsof -t -i:5174 2>/dev/null || true)
    if [ -n "$pid_5174" ]; then
        echo "Killing process on port 5174: $pid_5174"
        kill -9 $pid_5174 2>/dev/null || true
    fi
    
    # Also kill any remaining npm/node processes related to the project
    pkill -f "npm run dev" 2>/dev/null || true
    pkill -f "tsx watch" 2>/dev/null || true
    
    sleep 2
    echo -e "${GREEN}Cleanup complete${NC}"
}

# 启动后端
start_backend() {
    echo -e "${YELLOW}Starting backend on port 3000...${NC}"
    cd backend
    nohup npm run dev > ../logs/backend.log 2>&1 &
    BACKEND_PID=$!
    echo "Backend PID: $BACKEND_PID"
    cd ..
    
    # Wait for backend to be ready
    echo "Waiting for backend to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:3000/health > /dev/null 2>&1; then
            echo -e "${GREEN}Backend is ready!${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    
    echo -e "${RED}Backend failed to start within 30 seconds${NC}"
    return 1
}

# 启动前端
start_frontend() {
    echo -e "${YELLOW}Starting frontend on port 5174...${NC}"
    cd frontend
    nohup npm run dev -- --host --port 5174 > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo "Frontend PID: $FRONTEND_PID"
    cd ..
    
    # Wait for frontend to be ready
    echo "Waiting for frontend to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:5174 > /dev/null 2>&1; then
            echo -e "${GREEN}Frontend is ready!${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    
    echo -e "${RED}Frontend failed to start within 30 seconds${NC}"
    return 1
}

# 主函数
main() {
    # Create logs directory
    mkdir -p logs
    
    # Cleanup existing processes
    cleanup_ports
    
    # Start services
    if ! start_backend; then
        echo -e "${RED}Failed to start backend${NC}"
        exit 1
    fi
    
    if ! start_frontend; then
        echo -e "${RED}Failed to start frontend${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}✅ AgentMonitor test environment is running!${NC}"
    echo ""
    echo "📍 Frontend: http://localhost:5174"
    echo "📍 Backend:  http://localhost:3000"
    echo ""
    echo "Logs:"
    echo "  - Backend:  logs/backend.log"
    echo "  - Frontend: logs/frontend.log"
    echo ""
    echo "Press Ctrl+C to stop"
    
    # Keep script running
    wait
}

# Handle Ctrl+C
trap 'echo -e "\n${YELLOW}Shutting down...${NC}"; cleanup_ports; exit 0' INT

# Run main function
main