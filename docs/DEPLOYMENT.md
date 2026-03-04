# AgentMonitor 部署指南

> 本地开发、Docker 部署、生产环境部署完整指南

## 📋 目录

- [本地开发部署](#本地开发部署)
- [Docker 部署（推荐）](#docker-部署推荐)
- [生产环境部署](#生产环境部署)
- [环境变量配置](#环境变量配置)
- [常见问题](#常见问题)

---

## 本地开发部署

### 前置要求

- Node.js >= 18
- npm 或 yarn
- SQLite（自动包含，无需安装）

### 1. 克隆项目

```bash
git clone https://github.com/superwoman007/AgentMonitor.git
cd AgentMonitor
```

### 2. 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install

# SDK（可选，用于开发测试）
cd ../sdk
npm install
```

### 3. 启动服务

#### 方式 1：使用启动脚本（推荐）

```bash
# 在项目根目录
./start-all.sh
```

服务地址：
- 前端：http://localhost:5174
- 后端：http://localhost:3000

#### 方式 2：分别启动

```bash
# 终端 1：启动后端
cd backend
npm run dev

# 终端 2：启动前端
cd frontend
npm run dev
```

### 4. 访问面板

打开浏览器访问：http://localhost:5174

1. 注册账号
2. 创建项目
3. 生成 API Key
4. 开始使用 SDK

---

## Docker 部署（推荐）

### 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0

### 1. 使用 Docker Compose（一键部署）

```bash
git clone https://github.com/superwoman007/AgentMonitor.git
cd AgentMonitor

# 启动所有服务
docker-compose up -d
```

服务地址：
- 前端：http://localhost:5173
- 后端：http://localhost:3000
- PostgreSQL：localhost:5432（内部）

### 2. 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 3. 停止服务

```bash
docker-compose down

# 同时删除数据卷（清空数据库）
docker-compose down -v
```

### 4. 更新部署

```bash
git pull
docker-compose down
docker-compose build
docker-compose up -d
```

---

## 生产环境部署

### 架构选择

#### 选项 1：单机部署（小型团队）

```
┌─────────────────────────────────────┐
│         Nginx (反向代理)             │
│    :80/:443 → :5173 (前端)          │
│    /api → :3000 (后端)              │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  AgentMonitor (Docker Compose)      │
│  - Frontend (React)                 │
│  - Backend (Fastify)                │
│  - PostgreSQL                       │
└─────────────────────────────────────┘
```

#### 选项 2：分布式部署（大型团队）

```
┌─────────────┐
│  Load       │
│  Balancer   │
└──────┬──────┘
       │
   ┌───┴────┬────────┬────────┐
   ↓        ↓        ↓        ↓
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│Backend│ │Backend│ │Backend│ │Backend│
│ Node 1│ │ Node 2│ │ Node 3│ │ Node 4│
└───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘
    └─────────┴─────────┴─────────┘
                  ↓
         ┌────────────────┐
         │   PostgreSQL   │
         │   (Primary +   │
         │    Replicas)   │
         └────────────────┘
```

### 单机部署步骤

#### 1. 准备服务器

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y docker.io docker-compose nginx

# CentOS/RHEL
sudo yum install -y docker docker-compose nginx
sudo systemctl start docker
sudo systemctl enable docker
```

#### 2. 配置环境变量

```bash
# 创建 .env 文件
cat > .env << EOF
# 数据库配置
DB_TYPE=postgres
DATABASE_URL=postgresql://agentmonitor:your_password@postgres:5432/agentmonitor

# JWT 密钥（生产环境必须修改）
JWT_SECRET=$(openssl rand -hex 32)

# 后端配置
NODE_ENV=production
PORT=3000

# 前端配置
VITE_API_URL=https://your-domain.com/api
EOF
```

#### 3. 修改 docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: timescale/timescaledb:latest-pg15
    environment:
      POSTGRES_DB: agentmonitor
      POSTGRES_USER: agentmonitor
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  backend:
    build: ./backend
    environment:
      DB_TYPE: postgres
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    restart: unless-stopped

  frontend:
    build: ./frontend
    environment:
      VITE_API_URL: ${VITE_API_URL}
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - frontend
      - backend
    restart: unless-stopped

volumes:
  postgres_data:
```

#### 4. 配置 Nginx

```bash
# 创建 nginx.conf
cat > nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend:3000;
    }

    upstream frontend {
        server frontend:5173;
    }

    server {
        listen 80;
        server_name your-domain.com;

        # 重定向到 HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;

        # 前端
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # 后端 API
        location /api {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # WebSocket 支持
        location /ws {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
EOF
```

#### 5. 获取 SSL 证书（Let's Encrypt）

```bash
# 安装 certbot
sudo apt install -y certbot

# 获取证书
sudo certbot certonly --standalone -d your-domain.com

# 复制证书到项目目录
mkdir -p ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/key.pem
```

#### 6. 启动服务

```bash
docker-compose up -d
```

#### 7. 设置自动续期（SSL 证书）

```bash
# 添加 cron 任务
sudo crontab -e

# 每月 1 号凌晨 2 点续期
0 2 1 * * certbot renew --quiet && docker-compose restart nginx
```

---

## 环境变量配置

### 后端环境变量

| 变量名 | 说明 | 默认值 | 必填 |
|--------|------|--------|------|
| `PORT` | 后端端口 | `3000` | 否 |
| `NODE_ENV` | 环境 | `development` | 否 |
| `DB_TYPE` | 数据库类型 | `sqlite` | 否 |
| `DATABASE_URL` | PostgreSQL 连接串 | - | 使用 PG 时必填 |
| `SQLITE_PATH` | SQLite 文件路径 | `./data/agentmonitor.db` | 否 |
| `JWT_SECRET` | JWT 密钥 | `dev-secret-change-in-production` | **生产必填** |
| `JWT_EXPIRES_IN` | JWT 过期时间 | `7d` | 否 |

### 前端环境变量

| 变量名 | 说明 | 默认值 | 必填 |
|--------|------|--------|------|
| `VITE_API_URL` | 后端 API 地址 | `http://localhost:3000` | 否 |

### 示例配置

#### 开发环境

```bash
# backend/.env
PORT=3000
NODE_ENV=development
DB_TYPE=sqlite
SQLITE_PATH=./data/agentmonitor.db
JWT_SECRET=dev-secret

# frontend/.env
VITE_API_URL=http://localhost:3000
```

#### 生产环境

```bash
# .env (项目根目录)
PORT=3000
NODE_ENV=production
DB_TYPE=postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/agentmonitor
JWT_SECRET=your-super-secret-key-change-this
JWT_EXPIRES_IN=7d

VITE_API_URL=https://your-domain.com/api
```

---

## 数据库迁移

### SQLite → PostgreSQL

```bash
# 1. 导出 SQLite 数据
sqlite3 backend/data/agentmonitor.db .dump > dump.sql

# 2. 转换为 PostgreSQL 格式（需要手动调整）
# 主要修改：
# - AUTOINCREMENT → SERIAL
# - 布尔值 0/1 → false/true
# - 时间戳格式

# 3. 导入 PostgreSQL
psql -U agentmonitor -d agentmonitor -f dump.sql
```

---

## 监控与维护

### 健康检查

```bash
# 检查服务状态
curl http://localhost:3000/api/v1/stats

# 检查数据库连接
docker-compose exec backend npm run db:check
```

### 日志管理

```bash
# 查看实时日志
docker-compose logs -f --tail=100

# 导出日志
docker-compose logs > logs-$(date +%Y%m%d).txt
```

### 备份数据库

```bash
# PostgreSQL 备份
docker-compose exec postgres pg_dump -U agentmonitor agentmonitor > backup-$(date +%Y%m%d).sql

# SQLite 备份
cp backend/data/agentmonitor.db backup-$(date +%Y%m%d).db
```

### 性能优化

#### 1. PostgreSQL 调优

```sql
-- 增加连接池
ALTER SYSTEM SET max_connections = 200;

-- 优化查询缓存
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';

-- 重启生效
SELECT pg_reload_conf();
```

#### 2. Nginx 缓存

```nginx
# 在 nginx.conf 的 http 块中添加
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=1g inactive=60m;

server {
    location /api/v1/stats {
        proxy_cache api_cache;
        proxy_cache_valid 200 1m;
        proxy_pass http://backend;
    }
}
```

---

## 常见问题

### Q: 如何切换数据库？

**A:** 修改环境变量 `DB_TYPE`：
```bash
# SQLite（默认）
DB_TYPE=sqlite
SQLITE_PATH=./data/agentmonitor.db

# PostgreSQL
DB_TYPE=postgres
DATABASE_URL=postgresql://user:pass@host:5432/db
```

### Q: 忘记管理员密码怎么办？

**A:** 直接修改数据库：
```sql
-- SQLite
sqlite3 backend/data/agentmonitor.db
UPDATE users SET password = '$2b$10$...' WHERE email = 'admin@example.com';

-- PostgreSQL
psql -U agentmonitor -d agentmonitor
UPDATE users SET password = '$2b$10$...' WHERE email = 'admin@example.com';
```

### Q: 如何扩容？

**A:** 
1. 垂直扩容：增加服务器 CPU/内存
2. 水平扩容：启动多个后端实例 + 负载均衡
3. 数据库扩容：PostgreSQL 主从复制

### Q: 支持 Kubernetes 部署吗？

**A:** 支持，参考 `k8s/` 目录（待补充）。

---

## 🎉 部署完成

部署成功后，访问你的域名即可使用 AgentMonitor！

需要帮助？
- GitHub Issues: https://github.com/superwoman007/AgentMonitor/issues
- 文档: https://docs.agentmonitor.dev
