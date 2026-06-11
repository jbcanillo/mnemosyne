#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Mnemosyne — Full Backup & Restore
#
#  Backs up ALL critical Docker volumes. Use this BEFORE any full
#  `docker compose down`, or as scheduled backups.
#
#  Usage:
#    ./backup-chromadb.sh              # Create timestamped backup
#    ./backup-chromadb.sh restore <file.tar.gz>  # Restore from backup
# ═══════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ── Volume definitions ──────────────────────────────────────────────────
# Order matters for restore — list them in dependency order
VOLUMES=(
  "mnemosyne_ollama_data:ollama"
  "mnemosyne_chromadb_data:chromadb"
  "mnemosyne_redis_data:redis"
  "mnemosyne_rag_config:rag_config"
  "mnemosyne_rag_documents:documents"
  "mnemosyne_rag_uploads:uploads"
  "mnemosyne_rag_logs:logs"
)

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

# ── Verify Docker is available ──────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  error "Docker not found. Install Docker Desktop first."
fi

# ── Verify which volumes exist ──────────────────────────────────────────
echo ""
log "Checking Mnemosyne volumes..."
echo ""

EXISTING=()
MISSING=()

for entry in "${VOLUMES[@]}"; do
  vol="${entry%%:*}"
  name="${entry##*:}"
  if docker volume inspect "$vol" &>/dev/null; then
    EXISTING+=("$vol:$name")
  else
    MISSING+=("$vol ($name — volume not found)")
  fi
done

if [[ ${#EXISTING[@]} -eq 0 ]]; then
  warn "No Mnemosyne volumes found on this system."
  if [[ "${FORCE:-}" != "1" ]]; then
    read -p "Continue anyway? (volumes will appear as 0-byte archives) [y/N] " ans
    if [[ "${ans,,}" != "y" ]]; then
      log "Backup cancelled."
      exit 0
    fi
  fi
fi

echo ""
log "Volumes to back up:"
for entry in "${EXISTING[@]}"; do
  echo "  • ${entry%%:*}  (${entry##*:})"
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  warn "Skipped (not found):"
  for m in "${MISSING[@]}"; do echo "  • $m"; done
fi

echo ""

# ── Create backup ──────────────────────────────────────────────────────
backup() {
  log "Starting Mnemosyne backup..."
  echo ""

  CHROMADB_NAME="mnemosyne-chromadb"
  REDIS_NAME="mnemosyne-redis"
  BACKUP_FILE="${BACKUP_DIR}/mnemosyne_backup_${TIMESTAMP}.tar.gz"

  # Warn if containers not running (volume may still be accessible)
  if ! docker ps --format '{{.Names}}' | grep -q "^${CHROMADB_NAME}$"; then
    warn "ChromaDB container not running — backing up volume anyway"
  fi
  if ! docker ps --format '{{.Names}}' | grep -q "^${REDIS_NAME}$"; then
    warn "Redis container not running — backing up volume anyway"
  fi

  # Temp dir for per-volume archives
  TMPDIR=$(mktemp -d)
  trap "rm -rf \"$TMPDIR\"" EXIT

  FAILED=()
  WARNED_EMPTY=()

  for entry in "${EXISTING[@]}"; do
    vol="${entry%%:*}"
    name="${entry##*:}"
    part="${TMPDIR}/${name}_${TIMESTAMP}.tar.gz"

    log "Backing up ${vol}..."
    if docker run --rm \
      -v "${vol}:/source:ro" \
      -v "${TMPDIR}:/dest" \
      alpine \
      tar czf "/dest/${name}_${TIMESTAMP}.tar.gz" -C /source . 2>/dev/null; then

      # Validate the archive has content (not an empty stub)
      SIZE=$(stat -c%s "$part" 2>/dev/null || stat -f%z "$part" 2>/dev/null || echo 0)
      if [[ "$SIZE" -lt 100 ]]; then
        WARNED_EMPTY+=("$name (${SIZE} bytes — volume appears empty)")
        rm -f "$part"
      else
        success "Saved ${name}_${TIMESTAMP}.tar.gz ($(du -h "$part" | cut -f1))"
      fi
    else
      FAILED+=("$vol")
      warn "Failed to back up ${vol}"
    fi
  done

  echo ""
  if [[ ${#FAILED[@]} -gt 0 ]]; then
    error "Failed volumes: ${FAILED[*]}"
  fi

  if [[ ${#WARNED_EMPTY[@]} -gt 0 ]]; then
    warn "The following volumes appear EMPTY (0 content):"
    for w in "${WARNED_EMPTY[@]}"; do echo "  • $w"; done
    echo ""
    warn "If data should exist, volumes may have been deleted by Docker Desktop Purge."
    echo "Check for pre-rebuild backups:"
    echo "  ls backups/pre-rebuild/"
    echo ""
    if [[ "${FORCE:-}" != "1" ]]; then
      read -p "Continue creating combined archive anyway? [y/N] " ans
      if [[ "${ans,,}" != "y" ]]; then
        log "Backup cancelled."
        exit 0
      fi
    fi
  fi

  # Create combined archive from the valid parts
  PARTS=("${TMPDIR}"/*_"${TIMESTAMP}.tar.gz")
  if [[ ${#PARTS[@]} -eq 0 ]] || [[ ! -f "${PARTS[0]}" ]]; then
    error "No valid volume archives created. Cannot produce combined backup."
  fi

  log "Creating combined archive..."
  cd "${TMPDIR}"
  tar czf "${BACKUP_DIR}/mnemosyne_backup_${TIMESTAMP}.tar.gz" \
    ./*_"${TIMESTAMP}.tar.gz"

  # Final size
  SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
  success "Backup complete: ${BACKUP_FILE} (${SIZE})"
  echo ""
  echo -e "${GREEN}Backup saved to:${NC}"
  echo "  ${BACKUP_FILE}"
  echo ""
  echo "To restore later, run:"
  echo "  ${SCRIPT_DIR}/backup-chromadb.sh restore ${BACKUP_FILE}"
}

# ── Restore backup ─────────────────────────────────────────────────────
restore() {
  BACKUP_FILE="$1"

  if [[ -z "$BACKUP_FILE" ]]; then
    error "Usage: $0 restore <backup_file.tar.gz>"
  fi

  if [[ ! -f "$BACKUP_FILE" ]]; then
    error "Backup file not found: $BACKUP_FILE"
  fi

  # Resolve to absolute path
  if [[ "$BACKUP_FILE" != /* ]]; then
    BACKUP_FILE="${PROJECT_ROOT}/${BACKUP_FILE}"
  fi

  log "Preparing to restore from: $BACKUP_FILE"
  echo ""
  warn "This will STOP containers and OVERWRITE all Docker volumes!"
  echo "Current data will be lost unless you have a separate backup."
  echo ""
  read -p "Type 'yes' to confirm restore: " CONFIRM

  if [[ "$CONFIRM" != "yes" ]]; then
    log "Restore cancelled."
    exit 0
  fi

  log "Stopping containers..."
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" down 2>/dev/null || true

  # Extract backup to temporary directory
  TEMP_DIR=$(mktemp -d)
  trap "rm -rf \"$TEMP_DIR\"" EXIT

  log "Extracting backup..."
  tar xzf "$BACKUP_FILE" -C "$TEMP_DIR"

  # Find archives inside
  mapfile -t ARCHIVES < <(ls "$TEMP_DIR"/*.tar.gz 2>/dev/null | sort)
  if [[ ${#ARCHIVES[@]} -eq 0 ]]; then
    error "No backup archives found in: $BACKUP_FILE"
  fi

  success "Found ${#ARCHIVES[@]} backup archives:"
  for a in "${ARCHIVES[@]}"; do
    echo "  • $(basename "$a")  ($(du -h "$a" | cut -f1))"
  done
  echo ""

  # ── Restore each volume ────────────────────────────────────────────
  # Helper: find archive by prefix, restore into named volume
  restore_volume() {
    local prefix="$1"
    local vol="$2"
    local label="$3"

    local archive
    archive=$(ls "${TEMP_DIR}/${prefix}_"*.tar.gz 2>/dev/null | head -1 || true)
    if [[ -z "$archive" ]]; then
      warn "No archive found for ${label} (${prefix}_*.tar.gz) — skipping"
      return 0
    fi

    log "Restoring ${label}..."
    docker volume rm "$vol" 2>/dev/null || true
    docker volume create "$vol"
    docker run --rm \
      -v "$vol:/dest" \
      -v "${TEMP_DIR}:${TEMP_DIR}:ro" \
      alpine \
      tar xzf "$archive" -C /dest
    success "${label} restored"
  }

  restore_volume "ollama"      "mnemosyne_ollama_data"      "Ollama models"
  restore_volume "chromadb"    "mnemosyne_chromadb_data"    "ChromaDB"
  restore_volume "redis"       "mnemosyne_redis_data"       "Redis"
  restore_volume "rag_config"  "mnemosyne_rag_config"       "RAG config"
  restore_volume "documents"   "mnemosyne_rag_documents"    "Documents"
  restore_volume "uploads"     "mnemosyne_rag_uploads"      "Uploads"
  restore_volume "logs"        "mnemosyne_rag_logs"         "Logs"

  echo ""
  log "Starting containers..."
  docker compose -f "${PROJECT_ROOT}/docker-compose.yml" up -d

  log "Waiting for services to settle..."
  sleep 15

  success "Restore complete! Your data should be back."
  echo ""
  echo "Verify:"
  echo "  curl http://localhost:3001/health"
  echo "  open http://localhost:3001/api/documents"
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
  $0                        Create timestamped backup of all volumes
  $0 restore <file.tar.gz>  Restore from a backup file
  $0 list                   List available backups
  $0 cron                   Show crontab setup for daily backups"
fi
