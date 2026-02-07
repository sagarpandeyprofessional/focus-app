"use strict";
/**
 * @file    main/preload.ts
 * @purpose Secure IPC bridge between Electron main and renderer processes.
 *          Exposes only the APIs needed by the FOCUS renderer.
 * @owner   FOCUS Core Team
 * @depends electron (contextBridge, ipcRenderer)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // ─── Display & Capture ───────────────────
    getDisplays: () => electron_1.ipcRenderer.invoke('get-displays'),
    getDesktopSources: () => electron_1.ipcRenderer.invoke('get-desktop-sources'),
    getCursorPosition: () => electron_1.ipcRenderer.invoke('get-cursor-position'),
    getCursorDisplay: () => electron_1.ipcRenderer.invoke('get-cursor-display'),
    getFocusedWindowDisplay: () => electron_1.ipcRenderer.invoke('get-focused-window-display'),
    checkScreenPermission: () => electron_1.ipcRenderer.invoke('check-screen-permission'),
    requestScreenPermission: () => electron_1.ipcRenderer.invoke('request-screen-permission'),
    // ─── Presenter Controls (from main → renderer) ──
    onPresenterControl: (callback) => {
        const handler = (_event, control) => callback(control);
        electron_1.ipcRenderer.on('presenter-control', handler);
        return () => {
            electron_1.ipcRenderer.removeListener('presenter-control', handler);
        };
    },
    // ─── App Info ────────────────────────────
    getPlatform: () => process.platform,
    getVersion: () => electron_1.ipcRenderer.invoke('get-version'),
});
//# sourceMappingURL=preload.js.map