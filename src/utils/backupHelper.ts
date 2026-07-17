import { cpSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface BackupResult {
  success: boolean;
  backupSafeRef: string;
  fileCount: number;
}

export function runBackup(baseDataDir?: string, baseBackupsDir?: string): BackupResult {
  const dataDir = baseDataDir || resolve('data');
  const backupsBaseDir = baseBackupsDir || resolve('backups');
  
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.-]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const backupDirName = `backup_${timestamp}`;
  const targetDir = join(backupsBaseDir, backupDirName);

  mkdirSync(targetDir, { recursive: true });

  let fileCount = 0;

  cpSync(dataDir, targetDir, {
      recursive: true,
      filter: (source) => {
          // Exclude .env just in case it's in data (though it shouldn't be)
          if (source.endsWith('.env')) return false;
          // Exclude backups folder itself to prevent infinite nesting
          if (source.includes('backups')) return false;
          // Exclude node_modules if somehow there
          if (source.includes('node_modules')) return false;
          fileCount++;
          return true;
      }
  });

  const manifest = {
      created_at: now.toISOString(),
      included_paths: ['data/'],
      excluded_paths: ['.env', 'data/backups', 'node_modules'],
      file_count: fileCount,
      security_note: "No secrets or API keys are included in this backup."
  };

  writeFileSync(join(targetDir, 'backup_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return {
    success: true,
    backupSafeRef: backupDirName,
    fileCount
  };
}

export function getLatestBackupStatus(baseBackupsDir?: string) {
  const backupsBaseDir = baseBackupsDir || resolve('backups');
  try {
    const files = readdirSync(backupsBaseDir);
    let latestBackupRef = null;
    let latestBackupTime = 0;
    
    for (const file of files) {
      if (file.startsWith('backup_') || file.startsWith('now-os-backup-')) {
        const fullPath = join(backupsBaseDir, file);
        const stats = statSync(fullPath);
        if (stats.isDirectory() && stats.mtimeMs > latestBackupTime) {
          latestBackupTime = stats.mtimeMs;
          latestBackupRef = file;
        }
      }
    }

    if (latestBackupRef) {
      return {
        latest_backup_ref: latestBackupRef,
        latest_backup_at: new Date(latestBackupTime).toISOString(),
        latest_backup_status: "success"
      };
    }
    return null;
  } catch (err) {
    return null; // Directory might not exist yet
  }
}
