import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { startCodexStateBridge, type CodexStateSnapshot } from './codexStateBridge';
import {
  startDeepSeekStateBridge,
  type DeepSeekStateSnapshot,
} from './deepseekStateBridge';
import {
  createDesktopPetControls,
  type DesktopPetControls,
  type PetStateName,
} from './desktopPetControls';

const WINDOW_SIZE = 240;
const WINDOW_EDGE_MARGIN = 24;
const CODEX_STATE_CHANGED_CHANNEL = 'codex-state:changed';
const CODEX_STATE_READY_CHANNEL = 'codex-state:renderer-ready';
const DEEPSEEK_STATE_CHANGED_CHANNEL = 'deepseek-state:changed';
const DEEPSEEK_STATE_READY_CHANNEL = 'deepseek-state:renderer-ready';
const PET_STATE_CHANGED_CHANNEL = 'pet-state:changed';
const FOCUS_CODEX_CHANNEL = 'pet-window:focus-codex';
const FOCUS_DEEPSEEK_CHANNEL = 'pet-window:focus-deepseek';

let latestCodexState: CodexStateSnapshot | null = null;
let latestDeepSeekState: DeepSeekStateSnapshot | null = null;
let stopCodexStateBridge: (() => void) | undefined;
let stopDeepSeekStateBridge: (() => void) | undefined;
let petWindow: BrowserWindow | null = null;
let desktopPetControls: DesktopPetControls | null = null;
let currentPetState: PetStateName = 'IDLE';
let isQuitting = false;

const PET_STATE_NAMES = new Set<PetStateName>([
  'IDLE',
  'WORKING',
  'WAITING',
  'DONE',
  'ERROR',
]);

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const point = value as { x?: unknown; y?: unknown };
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function getPetWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender);
}

function isPetStateName(value: unknown): value is PetStateName {
  return typeof value === 'string' && PET_STATE_NAMES.has(value as PetStateName);
}

function registerWindowIpc() {
  ipcMain.on('pet-window:set-click-through', (event, ignore: unknown) => {
    if (typeof ignore !== 'boolean') {
      return;
    }

    getPetWindow(event)?.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.handle('pet-window:get-position', (event) => {
    const position = getPetWindow(event)?.getPosition() ?? [0, 0];
    return { x: position[0], y: position[1] };
  });

  ipcMain.handle(FOCUS_CODEX_CHANNEL, async (event) => {
    if (getPetWindow(event) !== petWindow) {
      return false;
    }

    try {
      await shell.openExternal('codex://');
      return true;
    } catch (error) {
      console.warn('[My Cat Pet] Unable to bring Codex to the foreground.', error);
      return false;
    }
  });

  ipcMain.handle(FOCUS_DEEPSEEK_CHANNEL, async (event) => {
    if (getPetWindow(event) !== petWindow || !latestDeepSeekState?.uiUrl) {
      return false;
    }

    try {
      await shell.openExternal(latestDeepSeekState.uiUrl);
      return true;
    } catch (error) {
      console.warn('[My Cat Pet] Unable to bring DeepSeek Harness to the foreground.', error);
      return false;
    }
  });

  ipcMain.on('pet-window:set-position', (event, point: unknown) => {
    if (!isFinitePoint(point)) {
      return;
    }

    const petWindow = getPetWindow(event);
    if (!petWindow) {
      return;
    }

    const display = screen.getDisplayNearestPoint({
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
    const area = display.workArea;
    const x = Math.min(Math.max(Math.round(point.x), area.x), area.x + area.width - WINDOW_SIZE);
    const y = Math.min(Math.max(Math.round(point.y), area.y), area.y + area.height - WINDOW_SIZE);

    petWindow.setPosition(x, y, false);
  });

  ipcMain.on(CODEX_STATE_READY_CHANNEL, (event) => {
    if (latestCodexState && !event.sender.isDestroyed()) {
      event.sender.send(CODEX_STATE_CHANGED_CHANNEL, latestCodexState);
    }
  });

  ipcMain.on(DEEPSEEK_STATE_READY_CHANNEL, (event) => {
    if (latestDeepSeekState && !event.sender.isDestroyed()) {
      event.sender.send(DEEPSEEK_STATE_CHANGED_CHANNEL, latestDeepSeekState);
    }
  });

  ipcMain.on(PET_STATE_CHANGED_CHANNEL, (event, state: unknown) => {
    if (getPetWindow(event) !== petWindow || !isPetStateName(state)) {
      return;
    }

    currentPetState = state;
    desktopPetControls?.setState(state);
  });
}

function broadcastCodexState(snapshot: CodexStateSnapshot) {
  latestCodexState = snapshot;
  for (const petWindow of BrowserWindow.getAllWindows()) {
    if (!petWindow.webContents.isDestroyed()) {
      petWindow.webContents.send(CODEX_STATE_CHANGED_CHANNEL, snapshot);
    }
  }
}

function broadcastDeepSeekState(snapshot: DeepSeekStateSnapshot) {
  latestDeepSeekState = snapshot;
  for (const petWindow of BrowserWindow.getAllWindows()) {
    if (!petWindow.webContents.isDestroyed()) {
      petWindow.webContents.send(DEEPSEEK_STATE_CHANGED_CHANNEL, snapshot);
    }
  }
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    return petWindow;
  }

  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const nextPetWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    x: primaryWorkArea.x + WINDOW_EDGE_MARGIN,
    y: primaryWorkArea.y + primaryWorkArea.height - WINDOW_SIZE - WINDOW_EDGE_MARGIN,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  petWindow = nextPetWindow;
  nextPetWindow.setAlwaysOnTop(true, 'floating');
  nextPetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  nextPetWindow.setIgnoreMouseEvents(true, { forward: true });

  nextPetWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      nextPetWindow.hide();
    }
  });

  nextPetWindow.on('closed', () => {
    if (petWindow === nextPetWindow) {
      petWindow = null;
    }
  });

  nextPetWindow.on('show', () => desktopPetControls?.refreshMenu());
  nextPetWindow.on('hide', () => desktopPetControls?.refreshMenu());

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void nextPetWindow.loadURL(devServerUrl);
  } else {
    void nextPetWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  return nextPetWindow;
}

function keepPetWindowOnScreen(targetWindow: BrowserWindow) {
  const [windowX, windowY] = targetWindow.getPosition();
  const display = screen.getDisplayNearestPoint({
    x: windowX + Math.round(WINDOW_SIZE / 2),
    y: windowY + Math.round(WINDOW_SIZE / 2),
  });
  const area = display.workArea;
  const x = Math.min(Math.max(windowX, area.x), area.x + area.width - WINDOW_SIZE);
  const y = Math.min(Math.max(windowY, area.y), area.y + area.height - WINDOW_SIZE);

  if (x !== windowX || y !== windowY) {
    targetWindow.setPosition(x, y, false);
  }
}

function showPetWindow() {
  const targetWindow = createPetWindow();
  keepPetWindowOnScreen(targetWindow);
  targetWindow.setAlwaysOnTop(true, 'floating');
  targetWindow.showInactive();
  targetWindow.moveTop();
}

function hidePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
}

function quitApplication() {
  isQuitting = true;
  app.quit();
}

app.whenReady().then(() => {
  registerWindowIpc();
  stopCodexStateBridge = startCodexStateBridge(broadcastCodexState);
  stopDeepSeekStateBridge = startDeepSeekStateBridge(broadcastDeepSeekState);
  createPetWindow();
  desktopPetControls = createDesktopPetControls({
    initialState: currentPetState,
    isPetVisible: () => Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
    showPet: showPetWindow,
    hidePet: hidePetWindow,
    quitApp: quitApplication,
  });

  app.on('activate', () => {
    showPetWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep the tray process and both state bridges alive without a visible window.
});

app.on('before-quit', () => {
  isQuitting = true;
  stopCodexStateBridge?.();
  stopDeepSeekStateBridge?.();
});

app.on('will-quit', () => {
  desktopPetControls?.dispose();
  desktopPetControls = null;
});
