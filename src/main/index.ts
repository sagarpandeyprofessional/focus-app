/**
 * @file    main/index.ts
 * @purpose Electron main process for FOCUS application.
 *          Handles app lifecycle, windows, IPC, screen enumeration,
 *          and global shortcuts for presenter controls.
 * @owner   FOCUS Core Team
 * @depends electron, shared/types/focus.ts
 */

import {
  app,
  BrowserWindow,
  screen,
  desktopCapturer,
  ipcMain,
  globalShortcut,
  systemPreferences,
} from 'electron';
import * as path from 'path';
import {
  ScreenId,
  DisplayBounds,
  PresenterControlAction,
} from '../shared/types/focus';

// ─────────────────────────────────────────────
// Window Management
// ─────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
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
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
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

function getDisplayBounds(): DisplayBounds[] {
  const displays = screen.getAllDisplays();
  return displays.map((display, index) => ({
    screenId: `screen_${index + 1}` as ScreenId,
    displayId: String(display.id),
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    dpiScale: display.scaleFactor,
  }));
}

function getCursorPosition(): { x: number; y: number } {
  return screen.getCursorScreenPoint();
}

// ─────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────

function setupIPC(): void {
  // Get available displays for screen selection UI
  ipcMain.handle('get-displays', () => {
    return getDisplayBounds();
  });

  // Get desktop sources for screen capture
  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({
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
  ipcMain.handle('get-cursor-position', () => {
    return getCursorPosition();
  });

  // Get cursor display id (more reliable than bounds mapping)
  ipcMain.handle('get-cursor-display', () => {
    const point = getCursorPosition();
    const display = screen.getDisplayNearestPoint(point);
    return String(display.id);
  });

  // Get focused window info
  ipcMain.handle('get-focused-window-display', () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (!focused) return null;

    const bounds = focused.getBounds();
    const displays = screen.getAllDisplays();

    // Find which display contains the focused window
    for (let i = 0; i < displays.length; i++) {
      const d = displays[i];
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;

      if (
        centerX >= d.bounds.x &&
        centerX < d.bounds.x + d.bounds.width &&
        centerY >= d.bounds.y &&
        centerY < d.bounds.y + d.bounds.height
      ) {
        return `screen_${i + 1}`;
      }
    }

    return null;
  });

  // Check screen recording permission (macOS)
  ipcMain.handle('check-screen-permission', async () => {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status === 'granted';
    }
    return true; // Windows/Linux don't require explicit permission
  });

  // Request screen recording permission (macOS)
  ipcMain.handle('request-screen-permission', async () => {
    if (process.platform === 'darwin') {
      // On macOS, we can only check — the user must grant in System Preferences
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status === 'granted';
    }
    return true;
  });
}

// ─────────────────────────────────────────────
// Global Shortcuts (Presenter Controls)
// ─────────────────────────────────────────────

function registerShortcuts(): void {
  // Toggle auto-focus: Ctrl+Shift+A
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    mainWindow?.webContents.send('presenter-control', {
      action: PresenterControlAction.ToggleAutoFocus,
      timestampMs: Date.now(),
    });
  });

  // Freeze focus: Ctrl+Shift+F
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    mainWindow?.webContents.send('presenter-control', {
      action: PresenterControlAction.ToggleFreeze,
      timestampMs: Date.now(),
    });
  });

  // Manual select screen 1: Ctrl+Shift+1
  globalShortcut.register('CommandOrControl+Shift+1', () => {
    mainWindow?.webContents.send('presenter-control', {
      action: PresenterControlAction.ManualSelect,
      screenId: 'screen_1',
      timestampMs: Date.now(),
    });
  });

  // Manual select screen 2: Ctrl+Shift+2
  globalShortcut.register('CommandOrControl+Shift+2', () => {
    mainWindow?.webContents.send('presenter-control', {
      action: PresenterControlAction.ManualSelect,
      screenId: 'screen_2',
      timestampMs: Date.now(),
    });
  });

  // Manual select screen 3: Ctrl+Shift+3
  globalShortcut.register('CommandOrControl+Shift+3', () => {
    mainWindow?.webContents.send('presenter-control', {
      action: PresenterControlAction.ManualSelect,
      screenId: 'screen_3',
      timestampMs: Date.now(),
    });
  });

  // Clear manual override: Ctrl+Shift+0
  globalShortcut.register('CommandOrControl+Shift+0', () => {
    mainWindow?.webContents.send('presenter-control', {
      action: PresenterControlAction.ClearManual,
      timestampMs: Date.now(),
    });
  });
}

// ─────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────

app.whenReady().then(() => {
  createMainWindow();
  setupIPC();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Security: disable navigation to external URLs
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });
});
