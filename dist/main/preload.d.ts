/**
 * @file    main/preload.ts
 * @purpose Secure IPC bridge between Electron main and renderer processes.
 *          Exposes only the APIs needed by the FOCUS renderer.
 * @owner   FOCUS Core Team
 * @depends electron (contextBridge, ipcRenderer)
 */
declare global {
    interface Window {
        electronAPI: {
            getDisplays: () => Promise<any[]>;
            getDesktopSources: () => Promise<any[]>;
            getCursorPosition: () => Promise<{
                x: number;
                y: number;
            }>;
            getFocusedWindowDisplay: () => Promise<string | null>;
            checkScreenPermission: () => Promise<boolean>;
            requestScreenPermission: () => Promise<boolean>;
            onPresenterControl: (callback: (control: any) => void) => () => void;
            getPlatform: () => string;
            getVersion: () => Promise<string>;
        };
    }
}
export {};
//# sourceMappingURL=preload.d.ts.map