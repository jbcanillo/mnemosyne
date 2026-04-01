const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

class BackupService {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'backups');
    this.ensureBackupDir();
  }

  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
      } catch (err) {
        logger.warn('[Backup] Could not create backups directory:', err.message);
      }
    }
  }

  /**
   * Create a config backup (JSON)
   * Note: Full ChromaDB backup must be done from the host via docker volume commands
   */
  async createBackup() {
    try {
      this.ensureBackupDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `mnemosyne_backup_${timestamp}.json`;
      const backupPath = path.join(this.backupDir, filename);

      // Backup config settings
      const configPath = path.join('/data', 'config', 'settings.json');
      let configData = null;
      if (fs.existsSync(configPath)) {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }

      const backup = {
        timestamp: new Date().toISOString(),
        config: configData,
        note: 'Config backup only. For full ChromaDB backup, use docker volume commands from the host.'
      };

      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      const stats = fs.statSync(backupPath);

      logger.info(`[Backup] Created: ${filename} (${stats.size} bytes)`);
      return {
        success: true,
        filename,
        size: Math.round(stats.size / 1024 * 100) / 100,
        timestamp: backup.timestamp
      };
    } catch (err) {
      logger.error('[Backup] Failed:', err.message);
      throw new Error(`Backup failed: ${err.message}`);
    }
  }

  /**
   * List available backups
   */
  async listBackups() {
    try {
      this.ensureBackupDir();
      if (!fs.existsSync(this.backupDir)) {
        return [];
      }

      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.endsWith('.tar.gz') || f.endsWith('.zip') || f.endsWith('.json'))
        .sort()
        .reverse();
      
      const backups = files.map(f => {
        try {
          const fullPath = path.join(this.backupDir, f);
          const stats = fs.statSync(fullPath);
          return {
            filename: f,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          };
        } catch (err) {
          return null;
        }
      }).filter(b => b !== null);

      return backups;
    } catch (err) {
      logger.error('[Backup] List failed:', err.message);
      return [];
    }
  }

  /**
   * Restore config from backup
   */
  async restoreBackup(filename) {
    try {
      const backupPath = path.join(this.backupDir, filename);
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${filename}`);
      }

      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

      if (backup.config) {
        const configPath = path.join('/data', 'config', 'settings.json');
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(backup.config, null, 2));
        logger.info('[Restore] Config restored');
      }

      return { success: true, message: 'Config restored. Note: ChromaDB data must be restored manually from host.' };
    } catch (err) {
      logger.error('[Restore] Failed:', err.message);
      throw new Error(`Restore failed: ${err.message}`);
    }
  }

  /**
   * Get backup size in MB
   */
  getBackupSize(filename) {
    if (!filename) return 0;
    try {
      const fullPath = path.join(this.backupDir, filename);
      const stats = fs.statSync(fullPath);
      return Math.round(stats.size / 1024 / 1024 * 100) / 100;
    } catch {
      return 0;
    }
  }
}

module.exports = new BackupService();
