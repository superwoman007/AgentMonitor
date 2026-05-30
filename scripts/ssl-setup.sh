#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SSL_DIR="$PROJECT_DIR/ssl"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

usage() {
  echo "Usage: $0 [--domain <domain> | --self-signed]"
  echo ""
  echo "Options:"
  echo "  --domain <domain>   Use Let's Encrypt for the specified domain"
  echo "  --self-signed       Generate a self-signed certificate (dev/testing)"
  echo ""
  echo "If no option is provided, you will be prompted interactively."
}

setup_self_signed() {
  local domain="${1:-localhost}"
  log_info "Generating self-signed certificate for: $domain"

  mkdir -p "$SSL_DIR"

  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$SSL_DIR/key.pem" \
    -out "$SSL_DIR/cert.pem" \
    -subj "/C=CN/ST=State/L=City/O=AgentMonitor/CN=$domain" \
    -addext "subjectAltName=DNS:$domain,DNS:localhost,IP:127.0.0.1" \
    2>/dev/null

  chmod 600 "$SSL_DIR/key.pem"
  chmod 644 "$SSL_DIR/cert.pem"

  log_ok "Self-signed certificate created:"
  log_info "  Certificate: $SSL_DIR/cert.pem"
  log_info "  Private key: $SSL_DIR/key.pem"
  log_warn "Browsers will show a security warning with self-signed certs."
}

setup_letsencrypt() {
  local domain="$1"

  if ! command -v certbot &>/dev/null; then
    log_error "certbot not found. Install it first:"
    echo "  Ubuntu/Debian: sudo apt install certbot"
    echo "  CentOS/RHEL:   sudo dnf install certbot"
    exit 1
  fi

  log_info "Obtaining Let's Encrypt certificate for: $domain"
  log_warn "Port 80 must be available (stopping frontend if running)."

  # Stop frontend if running to free port 80
  if docker ps --format '{{.Names}}' | grep -q agentmonitor-frontend; then
    log_info "Stopping frontend container to free port 80..."
    docker stop agentmonitor-frontend 2>/dev/null || true
  fi

  # Obtain certificate
  certbot certonly --standalone \
    -d "$domain" \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    || { log_error "certbot failed. Ensure DNS points to this server and port 80 is open."; exit 1; }

  # Copy to project ssl directory
  mkdir -p "$SSL_DIR"
  cp "/etc/letsencrypt/live/$domain/fullchain.pem" "$SSL_DIR/cert.pem"
  cp "/etc/letsencrypt/live/$domain/privkey.pem" "$SSL_DIR/key.pem"
  chmod 600 "$SSL_DIR/key.pem"
  chmod 644 "$SSL_DIR/cert.pem"

  # Setup auto-renewal cron
  setup_renewal_cron "$domain"

  log_ok "Let's Encrypt certificate installed:"
  log_info "  Certificate: $SSL_DIR/cert.pem"
  log_info "  Private key: $SSL_DIR/key.pem"
}

setup_renewal_cron() {
  local domain="$1"
  local cron_cmd="0 3 1 * * certbot renew --quiet --deploy-hook 'cp /etc/letsencrypt/live/$domain/fullchain.pem $SSL_DIR/cert.pem && cp /etc/letsencrypt/live/$domain/privkey.pem $SSL_DIR/key.pem && docker restart agentmonitor-frontend'"

  # Add to crontab if not already present
  if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "$cron_cmd") | crontab -
    log_ok "Auto-renewal cron job added (monthly at 3:00 AM)."
  else
    log_info "Certbot renewal cron already exists."
  fi
}

# === Main ===

MODE=""
DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      MODE="letsencrypt"
      DOMAIN="${2:-}"
      if [ -z "$DOMAIN" ]; then
        log_error "--domain requires a domain name"
        exit 1
      fi
      shift 2
      ;;
    --self-signed)
      MODE="self-signed"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

# Interactive mode if no flags
if [ -z "$MODE" ]; then
  echo ""
  echo "SSL Certificate Setup"
  echo "====================="
  echo "1) Let's Encrypt (production, requires domain pointing to this server)"
  echo "2) Self-signed (development/testing)"
  echo ""
  read -rp "Choose [1/2]: " choice

  case "$choice" in
    1)
      read -rp "Enter domain: " DOMAIN
      if [ -z "$DOMAIN" ]; then
        log_error "Domain is required for Let's Encrypt."
        exit 1
      fi
      MODE="letsencrypt"
      ;;
    2)
      read -rp "Enter domain (default: localhost): " DOMAIN
      DOMAIN="${DOMAIN:-localhost}"
      MODE="self-signed"
      ;;
    *)
      log_error "Invalid choice."
      exit 1
      ;;
  esac
fi

# Execute
case "$MODE" in
  letsencrypt)  setup_letsencrypt "$DOMAIN" ;;
  self-signed)  setup_self_signed "$DOMAIN" ;;
esac
