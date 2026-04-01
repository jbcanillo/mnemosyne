#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Mnemosyne RAG — ChromaDB Backup & Restore
#
#  Backs up the knowledge base (ChromaDB vector index) and config.
#  Usage:
#    ./backup-chromadb.sh              # Create timestamped backup
#    ./backup-chromadb.sh restore <file.tar.gz>  # Restore from backup
# ═══════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}✓ $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}"; exit 1; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }

# ── Create backup ──────────────────────────────────────────────────────
backup() {
  log "Starting Mnemosyne backup..."

  # Verify containers exist
  if ! docker ps -a --format '{{.Names}}' | grep -q '^mnemosyne-'; then
    error "Mnemosyne containers not found. Start with: docker compose up -d"
  fi

  CHROMADB_NAME="mnemosyne-chromadb"
  REDIS_NAME="mnemosyne-redis"
  BACKUP_FILE="${BACKUP_DIR}/mnemosyne_backup_${TIMESTAMP}.tar.gz"

  # Check if containers are running
  if ! docker ps --format '{{.Names}}' | grep -q "^${CHROMADB_NAME}$"; then
    warn "ChromaDB container not running — backing up volume anyway"
  fi

  if ! docker ps --format '{{.Names}}' | grep -q "^${REDIS_NAME}$"; then
    warn "Redis container not running — skipping Redis backup (ephemeral)"
  fi

  log "Backing up ChromaDB volume..."
  docker run --rm \
    -v mnemosyne_chromadb_data:/source \
    -v "${BACKUP_DIR}:/dest" \
    -v "${PROJECT_ROOT}:${PROJECT_ROOT}:ro" \
    alpine tar czf "/dest/chromadb_${TIMESTAMP}.tar.gz" -C /source . 2>/dev/null || error "Failed to backup ChromaDB"

  success "ChromaDB backed up: chromadb_${TIMESTAMP}.tar.gz"

  log "Backing up RAG config (API keys, settings)..."
  docker run --rm \
    -v mnemosyne_rag_config:/source \
    -v "${BACKUP_DIR}:/dest" \
    alpine tar czf "/dest/rag_config_${TIMESTAMP}.tar.gz" -C /source . 2>/dev/null || error "Failed to backup RAG config"

  success "RAG config backed up: rag_config_${TIMESTAMP}.tar.gz"

  log "Backing up Ollama models (optional, can be re-pulled)..."
  docker run --rm \
    -v mnemosyne_ollama_data:/source \
    -v "${BACKUP_DIR}:/dest" \
    alpine tar czf "/dest/ollama_${TIMESTAMP}.tar.gz" -C /source . 2>/dev/null || warn "Failed to backup Ollama (will re-pull on demand)"

  # Create combined archive
  log "Creating combined backup archive..."
  cd "$BACKUP_DIR"
  tar czf "mnemosyne_backup_${TIMESTAMP}.tar.gz" \
    "chromadb_${TIMESTAMP}.tar.gz" \
    "rag_config_${TIMESTAMP}.tar.gz" \
    "ollama_${TIMESTAMP}.tar.gz" 2>/dev/null || true

  # Cleanup individual files
  rm -f "chromadb_${TIMESTAMP}.tar.gz" "rag_config_${TIMESTAMP}.tar.gz" "ollama_${TIMESTAMP}.tar.gz"

  # Show final size
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  success "Backup complete: $BACKUP_FILE (${SIZE})"
  echo ""
  echo -e "${GREEN}Backup saved to:${NC}"
  echo "  $BACKUP_FILE"
  echo ""
  echo "To restore later, run:"
  echo "  ./scripts/backup-chromadb.sh restore $BACKUP_FILE"
}

# ── Restore backup ─────────────────────────────────────────────────────
restore() {
  BACKUP_FILE="$1"

  if [[ -z "$BACKUP_FILE" ]]; then
    error "Usage: ./scripts/backup-chromadb.sh restore <backup_file.tar.gz>"
  fi

  if [[ ! -f "$BACKUP_FILE" ]]; then
    error "Backup file not found: $BACKUP_FILE"
  fi

  log "Preparing to restore from: $BACKUP_FILE"
  echo ""
  warn "This will OVERWRITE your current knowledge base!"
  echo "Containers will be restarted. Queries will be interrupted."
  echo ""
  read -p "Type 'yes' to confirm restore: " CONFIRM

  if [[ "$CONFIRM" != "yes" ]]; then
    log "Restore cancelled"
    exit 0
  fi

  log "Stopping containers..."
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" down 2>/dev/null || true

  # Extract backup to temporary directory
  TEMP_DIR=$(mktemp -d)
  trap "rm -rf $TEMP_DIR" EXIT

  log "Extracting backup..."
  tar xzf "$BACKUP_FILE" -C "$TEMP_DIR"

  # List what we have
  ARCHIVES=$(ls "$TEMP_DIR"/*.tar.gz 2>/dev/null | wc -l)
  if [[ $ARCHIVES -eq 0 ]]; then
    error "No backup archives found in: $BACKUP_FILE"
  fi

  success "Found $ARCHIVES backup archives"

  # Restore ChromaDB
  if [[ -f "$TEMP_DIR/chromadb_"*.tar.gz ]]; then
    log "Restoring ChromaDB..."
    docker volume rm mnemosyne_chromadb_data 2>/dev/null || true
    docker volume create mnemosyne_chromadb_data
    docker run --rm \
      -v "$TEMP_DIR:$TEMP_DIR:ro" \
      -v mnemosyne_chromadb_data:/dest \
      alpine tar xzf "$TEMP_DIR/chromadb_"*.tar.gz -C /dest
    success "ChromaDB restored"
  fi

  # Restore RAG config
  if [[ -f "$TEMP_DIR/rag_config_"*.tar.gz ]]; then
    log "Restoring RAG config..."
    docker volume rm mnemosyne_rag_config 2>/dev/null || true
    docker volume create mnemosyne_rag_config
    docker run --rm \
      -v "$TEMP_DIR:$TEMP_DIR:ro" \
      -v mnemosyne_rag_config:/dest \
      alpine tar xzf "$TEMP_DIR/rag_config_"*.tar.gz -C /dest
    success "RAG config restored"
  fi

  # Optionally restore Ollama
  if [[ -f "$TEMP_DIR/ollama_"*.tar.gz ]]; then
    log "Restoring Ollama models (optional)..."
    docker volume rm mnemosyne_ollama_data 2>/dev/null || true
    docker volume create mnemosyne_ollama_data
    docker run --rm \
      -v "$TEMP_DIR:$TEMP_DIR:ro" \
      -v mnemosyne_ollama_data:/dest \
      alpine tar xzf "$TEMP_DIR/ollama_"*.tar.gz -C /dest
    success "Ollama models restored"
  fi

  log "Starting containers..."
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" up -d

  log "Waiting for containers to be healthy..."
  sleep 10

  success "Restore complete! Your knowledge base is back online."
  echo ""
  echo "Verify everything is working:"
  echo "  curl http://localhost:3001/health"
  echo "  open http://localhost:3000"
}

# ── List backups ───────────────────────────────────────────────────────
list_backups() {
  if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
    log "No backups found in: $BACKUP_DIR"
    exit 0
  fi

  echo ""
  echo -e "${BLUE}Available backups:${NC}"
  echo ""
  ls -lh "$BACKUP_DIR"/*.tar.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
  echo ""
}

# ── Schedule automated backups (cron) ───────────────────────────────────
schedule_cron() {
  CRON_JOB="0 2 * * * cd ${PROJECT_ROOT} && ${SCRIPT_DIR}/backup-chromadb.sh >> ${BACKUP_DIR}/cron.log 2>&1"

  echo ""
  echo -e "${BLUE}To enable daily 2 AM backups, add this to crontab:${NC}"
  echo ""
  echo "  crontab -e"
  echo ""
  echo "Then paste:"
  echo "  $CRON_JOB"
  echo ""
  echo "Verify with: crontab -l"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────
if [[ $# -eq 0 ]]; then
  backup
elif [[ "$1" == "restore" ]]; then
  restore "$2"
elif [[ "$1" == "list" ]]; then
  list_backups
elif [[ "$1" == "cron" ]]; then
  schedule_cron
else
  error "Unknown command: $1

Usage:
  $0                        Create backup with timestamp
  $0 restore <file.tar.gz>  Restore from backup
  $0 list                   List available backups
  $0 cron                   Show crontab setup for daily backups"
fi
