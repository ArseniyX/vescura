export const StorageKeys = {
    config:   "vescura.config",
    lastSync: (file: string) => `vescura.lastSync.${file}`,
    varState: (relPath: string) => `vescura.varState.${relPath}`,
    token:    (platform: string) => `vescura.token.${platform}`,
} as const;
