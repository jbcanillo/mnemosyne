# Backup & Restore Guide

This directory contains the backup utility for Mnemosyne RAG.

## Quick Start

```bash
# Create a backup
./backup-chromadb.sh

# List available backups
./backup-chromadb.sh list

# Restore from backup
./backup-chromadb.sh restore backups/mnemosyne_backup_20260331_020000.tar.gz

# Setup daily automated backups (cron)
./backup-chromadb.sh cron
```

## What Gets Backed Up

| Component | Size | Criticality |
|-----------|------|---|
| **ChromaDB** (vector index) | ~50 MB - 500+ MB | 🔴 CRITICAL — all documents |
| **RAG config** (API keys, settings) | ~1 MB | 🟡 Important — reusable config only |
| **Ollama models** (nomic-embed-text) | ~270 MB | 🟢 Optional — can re-pull |

**Total backup size:** ~320-770 MB depending on knowledge base size

## Backup Methods

### Manual Backup (One-time)

```bash
# From project root
./scripts/backup-chromadb.sh

# Creates: backups/mnemosyne_backup_YYYYMMDD_HHMMSS.tar.gz
```

### Automated Daily Backups (Cron)

```bash
# View cron setup instructions
./scripts/backup-chromadb.sh cron

# Output:
# crontab -e
#
# Then add:
# 0 2 * * * cd /path/to/mnemosyne && ./scripts/backup-chromadb.sh >> ./backups/cron.log 2>&1
```

This runs backups daily at **2:00 AM**. Adjust time in crontab as needed.

## Restore Process

```bash
# 1. Stop containers and restore from backup
./scripts/backup-chromadb.sh restore backups/mnemosyne_backup_20260331_020000.tar.gz

# 2. Confirm the restore (type 'yes' at prompt)

# 3. Verify restoration
curl http://localhost:3001/health
open http://localhost:3000
```

**Warning:** Restore **overwrites** your current knowledge base with the backup version.

## Backup Files Location

By default, backups are stored in: `backups/`

```
backups/
├── mnemosyne_backup_20260331_020000.tar.gz  (310 MB)
├── mnemosyne_backup_20260401_020000.tar.gz  (315 MB)
├── cron.log                                   (automated backup log)
└── ...
```

## Viewing Backup Contents

```bash
# List files in backup without extracting
tar tzf backups/mnemosyne_backup_*.tar.gz | head -20

# Extract to inspect (don't restore)
mkdir -p /tmp/inspect
tar xzf backups/mnemosyne_backup_*.tar.gz -C /tmp/inspect

# List what's in chromadb
ls -lah /tmp/inspect/chromadb_*.tar.gz
```

## Storage Recommendations

- **Local dev**: Keep last 5-7 backups (1-2 GB)
- **Production**: Keep last 30 days (10 GB) + monthly archive to cold storage
- **Cloud backup**: Sync `backups/` to S3, Backblaze, or similar

### Sync to S3 (Example)

```bash
# Requires: aws-cli configured
aws s3 sync ./backups s3://my-bucket/mnemosyne-rag/ --delete

# Restore from S3
aws s3 cp s3://my-bucket/mnemosyne-rag/mnemosyne_backup_*.tar.gz ./backups/
./scripts/backup-chromadb.sh restore ./backups/mnemosyne_backup_*.tar.gz
```

## Troubleshooting

### Backup Fails: "Containers not found"

```bash
# Ensure Docker containers are running
docker compose up -d

# Then retry
./scripts/backup-chromadb.sh
```

### Restore Stuck / Timeout

```bash
# Force-stop containers
docker compose kill

# Manually remove volumes (warning: erases data)
docker volume rm mnemosyne_chromadb_data mnemosyne_rag_config

# Then retry restore
./scripts/backup-chromadb.sh restore backups/mnemosyne_backup_*.tar.gz
```

### Low Disk Space Issues

```bash
# Check space
df -h

# Clean old backups (keep most recent 3)
ls -t backups/mnemosyne_backup_*.tar.gz | tail -n +4 | xargs rm -f

# Or prune aggressively (keep only latest)
ls -t backups/mnemosyne_backup_*.tar.gz | tail -n +2 | xargs rm -f
```

## Monitoring

The script creates `backups/cron.log` if running via cron. Monitor it:

```bash
# Watch backup logs
tail -f backups/cron.log

# Check last backup size/date
ls -lh backups/mnemosyne_backup_*.tar.gz | tail -1
```

## UI Access

**System Status** → **Data Management** section shows:
- Current knowledge base size (chunk count)
- Backup instructions
- Links to this script

---

**Next Steps:**
1. Run a manual backup: `./scripts/backup-chromadb.sh`
2. Verify it worked: `./scripts/backup-chromadb.sh list`
3. Setup cron for daily backups: `./scripts/backup-chromadb.sh cron`
4. Copy backups to cloud storage regularly
