import { chownSync, chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadSettings } from './settings.js';

// Railway mounts volumes as root. Initialize only our dedicated directory,
// then permanently drop privileges before importing any application code.
try {
  if (process.getuid?.() === 0) {
    const settings = loadSettings();
    const directory = '/data/company';
    const path = relative(directory, resolve(settings.databasePath));
    if (
      process.env.RAILWAY_VOLUME_MOUNT_PATH !== '/data' ||
      !path ||
      path.startsWith('../') ||
      path === '..' ||
      lstatSync('/data').isSymbolicLink() ||
      !lstatSync('/data').isDirectory() ||
      lstatSync('/data').uid !== 0
    )
      throw new Error(
        'Root startup requires a Railway volume at /data and database within /data/company',
      );
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const status = lstatSync(directory);
    if (!status.isDirectory() || status.isSymbolicLink())
      throw new Error('Company storage must be a real directory');
    chownSync(directory, 1000, 1000);
    chmodSync(directory, 0o700);
    // The app needs traversal through the root-owned mount, not directory listing.
    chmodSync('/data', 0o711);
    process.setgroups!([]);
    process.setgid!(1000);
    process.setuid!(1000);
  }
  process.umask(0o077);
  await import('./main.js');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Container startup failed');
  process.exitCode = 1;
}
