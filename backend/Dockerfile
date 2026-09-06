FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# tsc 不会拷贝 .sql 等非 TS 资产，迁移模块运行时需要读取 schema.sql
COPY src/db/schema.sql ./dist/db/schema.sql

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# node:alpine 不含 wget/curl，使用 node 自带能力做健康检查
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
