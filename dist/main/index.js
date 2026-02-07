"use strict";
/**
 * @file    main/index.ts
 * @purpose Electron main process for FOCUS application.
 *          Handles app lifecycle, windows, IPC, screen enumeration,
 *          and global shortcuts for presenter controls.
 * @owner   FOCUS Core Team
 * @depends electron, shared/types/focus.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const focus_1 = require("../shared/types/focus");
// ─────────────────────────────────────────────
// Window Management
// ─────────────────────────────────────────────
let mainWindow = null;
function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        title: 'FOCUS — Smart Multi-Screen Sharing',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // Required for desktopCapturer access
        },
        titleBarStyle: 'hiddenInset',
        show: false,
    });
    // Load the renderer
    const isDev = !electron_1.app.isPackaged;
    if (isDev) {
        mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    }
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// ─────────────────────────────────────────────
// Screen Enumeration
// ─────────────────────────────────────────────
function getDisplayBounds() {
    const displays = electron_1.screen.getAllDisplays();
    return displays.map((display, index) => ({
        screenId: `screen_${index + 1}`,
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        dpiScale: display.scaleFactor,
    }));
}
function getCursorPosition() {
    return electron_1.screen.getCursorScreenPoint();
}
// ─────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────
function setupIPC() {
    // Get available displays for screen selection UI
    electron_1.ipcMain.handle('get-displays', () => {
        return getDisplayBounds();
    });
    // Get desktop sources for screen capture
    electron_1.ipcMain.handle('get-desktop-sources', async () => {
        const sources = await electron_1.desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 320, height: 180 },
        });
        return sources.map((source) => ({
            id: source.id,
            name: source.name,
            display_id: source.display_id,
            thumbnail: source.thumbnail.toDataURL(),
        }));
    });
    // Get cursor position (for intent engine polling)
    electron_1.ipcMain.handle('get-cursor-position', () => {
        return getCursorPosition();
    });
    // Get focused window info
    electron_1.ipcMain.handle('get-focused-window-display', () => {
        const focused = electron_1.BrowserWindow.getFocusedWindow();
        if (!focused)
            return null;
        const bounds = focused.getBounds();
        const displays = electron_1.screen.getAllDisplays();
        // Find which display contains the focused window
        for (let i = 0; i < displays.length; i++) {
            const d = displays[i];
            const centerX = bounds.x + bounds.width / 2;
            const centerY = bounds.y + bounds.height / 2;
            if (centerX >= d.bounds.x &&
                centerX < d.bounds.x + d.bounds.width &&
                centerY >= d.bounds.y &&
                centerY < d.bounds.y + d.bounds.height) {
                return `screen_${i + 1}`;
            }
        }
        return null;
    });
    // Check screen recording permission (macOS)
    electron_1.ipcMain.handle('check-screen-permission', async () => {
        if (process.platform === 'darwin') {
            const status = electron_1.systemPreferences.getMediaAccessStatus('screen');
            return status === 'granted';
        }
        return true; // Windows/Linux don't require explicit permission
    });
    // Request screen recording permission (macOS)
    electron_1.ipcMain.handle('request-screen-permission', async () => {
        if (process.platform === 'darwin') {
            // On macOS, we can only check — the user must grant in System Preferences
            const status = electron_1.systemPreferences.getMediaAccessStatus('screen');
            return status === 'granted';
        }
        return true;
    });
}
// ─────────────────────────────────────────────
// Global Shortcuts (Presenter Controls)
// ─────────────────────────────────────────────
function registerShortcuts() {
    // Toggle auto-focus: Ctrl+Shift+A
    electron_1.globalShortcut.register('CommandOrControl+Shift+A', () => {
        mainWindow?.webContents.send('presenter-control', {
            action: focus_1.PresenterControlAction.ToggleAutoFocus,
            timestampMs: Date.now(),
        });
    });
    // Freeze focus: Ctrl+Shift+F
    electron_1.globalShortcut.register('CommandOrControl+Shift+F', () => {
        mainWindow?.webContents.send('presenter-control', {
            action: focus_1.PresenterControlAction.ToggleFreeze,
            timestampMs: Date.now(),
        });
    });
    // Manual select screen 1: Ctrl+Shift+1
    electron_1.globalShortcut.register('CommandOrControl+Shift+1', () => {
        mainWindow?.webContents.send('presenter-control', {
            action: focus_1.PresenterControlAction.ManualSelect,
            screenId: 'screen_1',
            timestampMs: Date.now(),
        });
    });
    // Manual select screen 2: Ctrl+Shift+2
    electron_1.globalShortcut.register('CommandOrControl+Shift+2', () => {
        mainWindow?.webContents.send('presenter-control', {
            action: focus_1.PresenterControlAction.ManualSelect,
            screenId: 'screen_2',
            timestampMs: Date.now(),
        });
    });
    // Manual select screen 3: Ctrl+Shift+3
    electron_1.globalShortcut.register('CommandOrControl+Shift+3', () => {
        mainWindow?.webContents.send('presenter-control', {
            action: focus_1.PresenterControlAction.ManualSelect,
            screenId: 'screen_3',
            timestampMs: Date.now(),
        });
    });
    // Clear manual override: Ctrl+Shift+0
    electron_1.globalShortcut.register('CommandOrControl+Shift+0', () => {
        mainWindow?.webContents.send('presenter-control', {
            action: focus_1.PresenterControlAction.ClearManual,
            timestampMs: Date.now(),
        });
    });
}
// ─────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    createMainWindow();
    setupIPC();
    registerShortcuts();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    electron_1.globalShortcut.unregisterAll();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('will-quit', () => {
    electron_1.globalShortcut.unregisterAll();
});
// Security: disable navigation to external URLs
electron_1.app.on('web-contents-created', (_, contents) => {
    contents.on('will-navigate', (event) => {
        event.preventDefault();
    });
});
//# sourceMappingURL=index.js.map