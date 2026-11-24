import { registerPlugin } from '@capacitor/core';

interface KramInstallerPlugin {
  canInstallUnknownApps(): Promise<{ granted: boolean }>;
  openInstallUnknownAppsSettings(): Promise<void>;
  installApk(options: { filePath: string }): Promise<{ completed: boolean; message: string }>;
}

export const KramInstaller = registerPlugin<KramInstallerPlugin>('KramInstaller');
