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
  echo "Usage: $0 [--domain <domain> | --self-signed [--ip <ip>...]]"
  echo ""
  echo "Options:"
  echo "  --domain <domain>   Use Let's Encrypt for the specified domain"
  echo "  --self-signed       Generate a self-signed certificate (no domain / IP access)"
  echo "  --ip <ip>           Add an extra IP to the self-signed cert SAN (repeatable)"
  echo ""
  echo "Self-signed mode auto-detects the host LAN IP(s) and always includes"
  echo "127.0.0.1 and localhost, so the cert works for IP-based HTTPS access."
  echo ""
  echo "If no option is provided, you will be prompted interactively."
}

# 探测本机所有局域网 IPv4 地址（排除回环/ docker / bridge 虚拟网卡常见网段）。
# @returns 换行分隔的 IP 列表
detect_lan_ips() {
  if command -v ip &>/dev/null; then
    ip -4 addr show 2>/dev/null \
      | grep -oE 'inet [0-9.]+' \
      | awk '{print $2}' \
      | grep -vE '^127\.'
  elif command -v ifconfig &>/dev/null; then
    ifconfig 2>/dev/null \
      | grep -oE 'inet [0-9.]+' \
      | awk '{print $2}' \
      | grep -vE '^127\.'
  else
    # 兜底：取默认路由出口 IP
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^127\.' || true
  fi
}

# 生成自签证书。
# @param $1  逗号分隔的额外 SAN（域名或 IP），可为空
setup_self_signed() {
  local extra_san="${1:-}"
  mkdir -p "$SSL_DIR"

  # 汇总 SAN：localhost、127.0.0.1 + 自动探测到的局域网 IP + 用户额外指定项，去重。
  local san_entries="DNS:localhost,IP:127.0.0.1"
  local detected
  detected="$(detect_lan_ips || true)"
  local ip
  for ip in $detected; do
    san_entries="${san_entries},IP:${ip}"
  done
  # 用户通过 --ip 或交互传入的额外项
  local item
  IFS=',' read -ra items <<< "$extra_san"
  for item in "${items[@]}"; do
    item="$(echo "$item" | xargs || true)"
    [ -z "$item" ] && continue
    if [[ "$item" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      san_entries="${san_entries},IP:${item}"
    else
      san_entries="${san_entries},DNS:${item}"
    fi
  done

  # 去重 SAN 项
  san_entries="$(echo "$san_entries" | tr ',' '\n' | awk '!seen[$0]++' | paste -sd ',' -)"

  log_info "Generating self-signed certificate with SAN: $san_entries"

  local openssl_cnf="$SSL_DIR/openssl-san.cnf"
  # 将 "DNS:x,IP:y" 转为 openssl alt_names 段所需的 "DNS.1 = x" / "IP.2 = y" 形式。
  local alt_names_block
  alt_names_block="$(
    echo "$san_entries" | tr ',' '\n' | awk '
      {
        n = split($0, kv, ":");
        kind = kv[1];
        val = kv[2];
        if (kind == "DNS") { dns[++dnsn] = val; }
        else if (kind == "IP") { ips[++ipsn] = val; }
      }
      END {
        for (i = 1; i <= dnsn; i++) printf "DNS.%d = %s\n", i, dns[i];
        for (i = 1; i <= ipsn; i++) printf "IP.%d = %s\n", i, ips[i];
      }'
  )"
  cat > "$openssl_cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no
[req_distinguished_name]
C = CN
ST = State
L = City
O = AgentMonitor
CN = AgentMonitor Self-Signed
[v3_req]
subjectAltName = @alt_names
[alt_names]
${alt_names_block}
EOF

  openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "$SSL_DIR/key.pem" \
    -out "$SSL_DIR/cert.pem" \
    -config "$openssl_cnf" \
    -extensions v3_req

  chmod 600 "$SSL_DIR/key.pem"
  chmod 644 "$SSL_DIR/cert.pem"

  log_ok "Self-signed certificate created:"
  log_info "  Certificate: $SSL_DIR/cert.pem"
  log_info "  Private key: $SSL_DIR/key.pem"
  log_info "  SAN config:  $openssl_cnf"
  log_warn "Browsers will show a security warning with self-signed certs."
  log_warn "Access via https://<server-ip>/ and manually trust the certificate."
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
EXTRA_IPS=()

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
    --ip)
      EXTRA_IPS+=("${2:-}")
      if [ -z "${2:-}" ]; then
        log_error "--ip requires an IP address"
        exit 1
      fi
      shift 2
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
  echo "2) Self-signed (no domain, access via IP / development / testing)"
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
      read -rp "Enter extra IPs to include in SAN (comma-separated, blank to auto-detect): " EXTRA
      if [ -n "$EXTRA" ]; then
        IFS=',' read -ra _ips <<< "$EXTRA"
        for _i in "${_ips[@]}"; do EXTRA_IPS+=("$(echo "$_i" | xargs)"); done
      fi
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
  self-signed)  setup_self_signed "$(IFS=','; echo "${EXTRA_IPS[*]:-}")" ;;
esac
