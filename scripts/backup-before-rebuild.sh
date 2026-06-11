#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Mnemosyne — Pre-Rebuild Safety Backup
#
#  Creates timestamped backups of critical Docker volumes BEFORE
#  running docker compose down (for rebuilds or env changes).
#
#  Usage:
#    ./backup-before-rebuild.sh [--auto]
#
#  With --auto: skips interactive prompts (useful in scripts/aliases)
# ═══════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_ROOT="${PROJECT_ROOT}/backups/pre-rebuild"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
AUTO_MODE=false

if [[ "${1:-}" == "--auto" ]]; then
  AUTO_MODE=true
fi

VOLUMES=(
  "mnemosyne_chromadb_data:chromadb"
  "mnemosyne_redis_data:redis"
  "mnemosyne_rag_config:rag_config"
  "mnemosyne_rag_documents:documents"
  "mnemosyne_rag_uploads:uploads"
  "mnemosyne_rag_logs:logs"
  "mnemosyne_ollama_data:ollama"
)

MIN_VALID_SIZE=100

mkdir -p "$BACKUP_ROOT"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"; }
good() { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Verify Docker is available ─────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  err "Docker not found. Install Docker Desktop first."
fi

echo ""
log "Mnemosyne — Pre-Rebuild Safety Backup"
echo ""

# ── Check which volumes actually exist ─────────────────────────────────
BACKED_UP=()
SKIPPED=()

for entry in "${VOLUMES[@]}"; do
  vol="${entry%%:*}"
  name="${entry##*:}"

  if docker volume inspect "$vol" &>/dev/null; then
    BACKED_UP+=("$vol:$name")
  else
    SKIPPED+=("$vol ($name — volume not found)")
  fi
done

if [[ ${#BACKED_UP[@]} -eq 0 ]]; then
  warn "No Mnemosyne volumes found. Nothing to back up."
  if [[ "$AUTO_MODE" == true ]]; then
    exit 0
  fi
  read -p "Continue with docker compose down anyway? [y/N] " ans
  if [[ "${ans,,}" != "y" ]]; then
    log "Aborted."
    exit 0
  fi
  exit 0
fi

# ── Warn user ──────────────────────────────────────────────────────────
echo ""
log "The following volumes will be backed up:"
for entry in "${BACKED_UP[@]}"; do
  echo "  • ${entry%%:*}  (${entry##*:})"
done

if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo ""
  warn "Skipped (not found):"
  for s in "${SKIPPED[@]}"; do echo "  • $s"; done
fi

echo ""
echo -e "${YELLOW}⚠  After this backup, you can safely run:${NC}"
echo "    docker compose down"
echo "    docker compose up --build"
echo ""
if [[ "$AUTO_MODE" == false ]]; then
  read -p "Proceed with backup? [Y/n] " ans
  if [[ "${ans,,}" == "n" ]]; then
    log "Cancelled."
    exit 0
  fi
fi

# ── Perform backups ────────────────────────────────────────────────────
log "Backing up volumes to: ${BACKUP_ROOT}"
echo ""

TMPDIR=$(mktemp -d)
trap "rm -rf \"$TMPDIR\"" EXIT

FAILED=()
EMPTY=()

for entry in "${BACKED_UP[@]}"; do
  vol="${entry%%:*}"
  name="${entry##*:}"
  dest_tar="${TMPDIR}/${name}_${TIMESTAMP}.tar.gz"

  log "Backing up ${vol}..."
  if docker run --rm \
    -v "${vol}:/source:ro" \
    -v "${TMPDIR}:/dest" \
    alpine \
    tar czf "/dest/${name}_${TIMESTAMP}.tar.gz" -C /source .; then

    VALID_SIZE=$MIN_VALID_SIZE
    SIZE=$(stat -c%s "$dest_tar" 2>/dev/null || stat -f%z "$dest_tar" 2>/dev/null || echo 0)
    if [[ "$SIZE" -lt "$VALID_SIZE" ]]; then
      EMPTY+=("$name (${SIZE} bytes — volume appears empty)")
      rm -f "$dest_tar"
    else
      good "Created ${dest_tar##*/} ($(du -h "$dest_tar" | cut -f1))"
    fi
  else
    FAILED+=("$vol")
    warn "Failed to back up ${vol}"
  fi
done

echo ""

# ── Validate outcomes ──────────────────────────────────────────────────
if [[ ${#FAILED[@]} -gt 0 ]]; then
  err "Backup failed for volumes: ${FAILED[*]}"
fi

if [[ ${#EMPTY[@]} -gt 0 ]]; then
  warn "The following volumes appear EMPTY:"
  for e in "${EMPTY[@]}"; do echo "  • $e"; done
  echo ""
  warn "If data should exist, volumes may have been deleted by Docker Desktop Purge."
  echo "Check for earlier backups:"
  echo "  ls ${PROJECT_ROOT}/backups/"
  echo ""
  if [[ "$AUTO_MODE" == false ]]; then
    read -p "Continue storing partial backup anyway? [y/N] " ans
    if [[ "${ans,,}" != "y" ]]; then
      log "Cancelled."
      exit 0
    fi
  fi
fi

# ── Move valid archives into pre-rebuild directory ─────────────────────
MOVED=()
for f in "${TMPDIR}"/*_"${TIMESTAMP}.tar.gz"; do
  [[ -f "$f" ]] || continue
  cp "$f" "${BACKUP_ROOT}/"
  MOVED+=("$(basename "$f")")
done

if [[ ${#MOVED[@]} -eq 0 ]]; then
  warn "No valid archives to store. Nothing was backed up."
  exit 0
fi

echo ""
log "Pre-rebuild backup complete: ${TIMESTAMP}"
echo ""
good "Backups stored in: ${BACKUP_ROOT}"
echo ""
for f in "${MOVED[@]}"; do
  fpath="${BACKUP_ROOT}/${f}"
  echo "  • ${f}  ($(du -h "$fpath" | cut -f1))"
done
echo ""

if [[ "$AUTO_MODE" == true ]]; then
  log "Auto mode — proceeding with rebuild..."
else
  echo -e "${GREEN}You can now run:${NC}"
  echo "    docker compose down"
  echo "    docker compose up --build"
  echo ""
  echo "To restore later:"
  echo "    ./scripts/backup-chromadb.sh restore backups/pre-rebuild/${MOVED[0]}"
  echo ""
  echo "Or use the combined backup directly:"
  echo "    ./scripts/backup-chromadb.sh list"
  echo ""
fi
