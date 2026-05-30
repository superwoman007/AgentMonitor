#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
RETENTION_DAYS=7

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Load env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

PG_DATABASE="${PG_DATABASE:-agentmonitor}"
PG_USER="${PG_USER:-postgres}"
CONTAINER_NAME="agentmonitor-postgres"

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log_error "PostgreSQL container '$CONTAINER_NAME' is not running."
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/${PG_DATABASE}_${TIMESTAMP}.sql.gz"

# Perform backup
log_info "Backing up database '$PG_DATABASE'..."

docker exec "$CONTAINER_NAME" \
  pg_dump -U "$PG_USER" "$PG_DATABASE" \
  | gzip > "$BACKUP_FILE"

chmod 600 "$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log_ok "Backup complete: $BACKUP_FILE ($FILESIZE)"

# Cleanup old backups
log_info "Cleaning backups older than $RETENTION_DAYS days..."
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log_info "Deleted $DELETED old backup(s)."
else
  log_info "No old backups to clean."
fi

# List current backups
echo ""
log_info "Current backups:"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
