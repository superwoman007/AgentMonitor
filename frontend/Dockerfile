FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 80 用于 HTTP→HTTPS 跳转，443 承载 HTTPS（证书通过 ssl 卷挂载到 /etc/nginx/ssl）
EXPOSE 80
EXPOSE 443

CMD ["nginx", "-g", "daemon off;"]
