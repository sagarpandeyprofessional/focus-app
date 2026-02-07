/**
 * @file    main/preload.ts
 * @purpose Secure IPC bridge between Electron main and renderer processes.
 *          Exposes only the APIs needed by the FOCUS renderer.
 * @owner   FOCUS Core Team
 * @depends electron (contextBridge, ipcRenderer)
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Display & Capture ───────────────────
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
  getCursorDisplay: () => ipcRenderer.invoke('get-cursor-display'),
  getFocusedWindowDisplay: () => ipcRenderer.invoke('get-focused-window-display'),
  checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),

  // ─── Presenter Controls (from main → renderer) ──
  onPresenterControl: (callback: (control: any) => void) => {
    const handler = (_event: any, control: any) => callback(control);
    ipcRenderer.on('presenter-control', handler);
    return () => {
      ipcRenderer.removeListener('presenter-control', handler);
    };
  },

  // ─── App Info ────────────────────────────
  getPlatform: () => process.platform,
  getVersion: () => ipcRenderer.invoke('get-version'),
});

// Type declaration for renderer access
declare global {
  interface Window {
    electronAPI: {
      getDisplays: () => Promise<any[]>;
      getDesktopSources: () => Promise<any[]>;
      getCursorPosition: () => Promise<{ x: number; y: number }>;
      getCursorDisplay: () => Promise<string>;
      getFocusedWindowDisplay: () => Promise<string | null>;
      checkScreenPermission: () => Promise<boolean>;
      requestScreenPermission: () => Promise<boolean>;
      onPresenterControl: (callback: (control: any) => void) => () => void;
      getPlatform: () => string;
      getVersion: () => Promise<string>;
    };
  }
}
