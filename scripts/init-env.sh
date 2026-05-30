#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }

if [ -f "$ENV_FILE" ]; then
  log_warn ".env file already exists at $ENV_FILE"
  read -rp "Overwrite? [y/N]: " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""
log_info "=== AgentMonitor Environment Setup ==="
echo ""

# Domain
read -rp "Enter your domain (e.g., monitor.example.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
  log_warn "No domain provided. Using localhost."
  DOMAIN="localhost"
fi

# Database password
PG_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
log_ok "Generated database password."

# JWT Secret
JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)
log_ok "Generated JWT secret (64 chars)."

# CORS origins
if [ "$DOMAIN" = "localhost" ]; then
  CORS_ORIGINS="http://localhost,http://localhost:5174"
else
  CORS_ORIGINS="https://$DOMAIN"
fi

# Write .env
cat > "$ENV_FILE" << EOF
# AgentMonitor Production Configuration
# Generated on $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# ============ REQUIRED ============

JWT_SECRET=$JWT_SECRET
CORS_ORIGINS=$CORS_ORIGINS

# ============ DATABASE ============

DB_TYPE=postgres
PG_USER=postgres
PG_PASSWORD=$PG_PASSWORD
PG_DATABASE=agentmonitor
PG_HOST=postgres
PG_PORT=5432
DB_SSL=false

# ============ JWT ============

JWT_ACCESS_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=30d

# ============ SECURITY ============

API_KEY_EXPIRATION_DAYS=90

# ============ RATE LIMITING ============

RATE_LIMIT_MAX=100
RATE_LIMIT_AUTH_MAX=5

# ============ WEBSOCKET ============

WS_MAX_CONNECTIONS=1000
WS_MAX_PER_USER=10

# ============ DATABASE POOL ============

DB_POOL_MAX=20
DB_POOL_IDLE_TIMEOUT=30000
EOF

chmod 600 "$ENV_FILE"

echo ""
log_ok "Environment file created: $ENV_FILE"
log_info "Domain: $DOMAIN"
log_info "CORS: $CORS_ORIGINS"
log_info "DB Password: (auto-generated, stored in .env)"
log_info "JWT Secret: (auto-generated, 64 chars)"
echo ""
log_warn "Review and adjust .env if needed before starting services."
