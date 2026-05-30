#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS="${GREEN}✓${NC}"
FAIL="${RED}✗${NC}"
WARN="${YELLOW}!${NC}"

# Detect docker compose
if docker compose version &>/dev/null; then
  COMPOSE="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE="docker-compose"
else
  echo -e "${FAIL} Docker Compose not found"
  exit 1
fi

echo ""
echo "=== AgentMonitor Health Check ==="
echo ""

ERRORS=0

# Check containers
echo "Containers:"
for service in postgres backend frontend; do
  container="agentmonitor-$service"
  if docker ps --format '{{.Names}} {{.Status}}' | grep -q "^$container"; then
    status=$(docker ps --format '{{.Status}}' --filter "name=$container")
    if echo "$status" | grep -q "healthy"; then
      echo -e "  $PASS $service: $status"
    elif echo "$status" | grep -q "Up"; then
      echo -e "  $WARN $service: $status (no healthcheck or starting)"
    else
      echo -e "  $FAIL $service: $status"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo -e "  $FAIL $service: not running"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
echo "Endpoints:"

# Check backend health (internal)
if curl -sf --max-time 5 http://localhost:3000/api/v1/health &>/dev/null; then
  echo -e "  $PASS Backend API: http://localhost:3000/api/v1/health"
else
  # Try via docker network
  if docker exec agentmonitor-backend wget -q --spider http://localhost:3000/api/v1/health 2>/dev/null; then
    echo -e "  $PASS Backend API: reachable (internal only)"
  else
    echo -e "  $FAIL Backend API: unreachable"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Check HTTPS frontend
if curl -skf --max-time 5 https://localhost &>/dev/null; then
  echo -e "  $PASS Frontend HTTPS: https://localhost"
elif curl -sf --max-time 5 http://localhost &>/dev/null; then
  echo -e "  $WARN Frontend HTTP: http://localhost (HTTPS not configured)"
else
  echo -e "  $FAIL Frontend: unreachable"
  ERRORS=$((ERRORS + 1))
fi

# Check database
echo ""
echo "Database:"
if docker exec agentmonitor-postgres pg_isready -U postgres &>/dev/null; then
  echo -e "  $PASS PostgreSQL: accepting connections"
else
  echo -e "  $FAIL PostgreSQL: not ready"
  ERRORS=$((ERRORS + 1))
fi

# Disk usage
echo ""
echo "Resources:"
PGDATA_SIZE=$(docker exec agentmonitor-postgres du -sh /var/lib/postgresql/data 2>/dev/null | cut -f1 || echo "N/A")
echo "  Database size: $PGDATA_SIZE"

# Summary
echo ""
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
else
  echo -e "${RED}$ERRORS check(s) failed.${NC}"
  exit 1
fi
