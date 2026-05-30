#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Detect docker compose command
detect_compose() {
  if docker compose version &>/dev/null; then
    COMPOSE="docker compose"
  elif docker-compose version &>/dev/null; then
    COMPOSE="docker-compose"
  else
    log_error "Docker Compose not found. Install Docker with Compose plugin."
    exit 1
  fi
}

# Check dependencies
check_deps() {
  local missing=()
  command -v docker &>/dev/null || missing+=("docker")
  command -v openssl &>/dev/null || missing+=("openssl")
  command -v curl &>/dev/null || missing+=("curl")

  if [ ${#missing[@]} -gt 0 ]; then
    log_error "Missing dependencies: ${missing[*]}"
    exit 1
  fi

  if ! docker info &>/dev/null; then
    log_error "Docker daemon is not running."
    exit 1
  fi

  detect_compose
  log_ok "All dependencies satisfied. Using: $COMPOSE"
}

# === Commands ===

cmd_init() {
  log_info "=== AgentMonitor Initial Deployment ==="
  check_deps

  # Step 1: Environment
  if [ ! -f .env ]; then
    log_info "Generating environment configuration..."
    bash scripts/init-env.sh
  else
    log_warn ".env already exists. Skipping environment setup."
  fi

  # Step 2: SSL
  if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ]; then
    log_info "Setting up SSL certificates..."
    bash scripts/ssl-setup.sh "$@"
  else
    log_ok "SSL certificates already exist."
  fi

  # Step 3: Build and start
  log_info "Building and starting services..."
  $COMPOSE up -d --build

  # Step 4: Wait and check
  log_info "Waiting for services to be healthy..."
  sleep 10
  cmd_status
}

cmd_update() {
  log_info "=== Updating AgentMonitor ==="
  check_deps

  # Pull latest code if in git repo
  if [ -d .git ]; then
    log_info "Pulling latest code..."
    git pull --ff-only || { log_warn "Git pull failed. Continuing with local code."; }
  fi

  # Rebuild and restart
  log_info "Rebuilding services..."
  $COMPOSE up -d --build

  sleep 8
  cmd_status
}

cmd_restart() {
  check_deps
  log_info "Restarting services..."
  $COMPOSE restart
  sleep 5
  cmd_status
}

cmd_stop() {
  check_deps
  log_info "Stopping services..."
  $COMPOSE down
  log_ok "All services stopped."
}

cmd_status() {
  check_deps
  bash scripts/health-check.sh
}

cmd_logs() {
  check_deps
  local service="${1:-}"
  if [ -n "$service" ]; then
    $COMPOSE logs -f --tail=100 "$service"
  else
    $COMPOSE logs -f --tail=100
  fi
}

cmd_backup() {
  check_deps
  bash scripts/backup.sh
}

# === Main ===

usage() {
  echo "Usage: $0 <command> [options]"
  echo ""
  echo "Commands:"
  echo "  init [--domain <domain> | --self-signed]  First-time deployment"
  echo "  update                                     Pull & rebuild services"
  echo "  restart                                    Restart all services"
  echo "  stop                                       Stop all services"
  echo "  status                                     Health check"
  echo "  logs [service]                             View logs"
  echo "  backup                                     Backup database"
  echo ""
  echo "Examples:"
  echo "  $0 init --domain monitor.example.com"
  echo "  $0 init --self-signed"
  echo "  $0 update"
  echo "  $0 logs backend"
}

case "${1:-}" in
  init)    shift; cmd_init "$@" ;;
  update)  cmd_update ;;
  restart) cmd_restart ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  logs)    shift; cmd_logs "${1:-}" ;;
  backup)  cmd_backup ;;
  -h|--help|help) usage ;;
  *)       usage; exit 1 ;;
esac
