import { contextBridge, ipcRenderer } from 'electron';

const CODEX_STATE_CHANGED_CHANNEL = 'codex-state:changed';
const CODEX_STATE_READY_CHANNEL = 'codex-state:renderer-ready';
const DEEPSEEK_STATE_CHANGED_CHANNEL = 'deepseek-state:changed';
const DEEPSEEK_STATE_READY_CHANNEL = 'deepseek-state:renderer-ready';

contextBridge.exposeInMainWorld('petWindow', {
  setClickThrough(ignore: boolean) {
    ipcRenderer.send('pet-window:set-click-through', ignore);
  },
  getPosition() {
    return ipcRenderer.invoke('pet-window:get-position') as Promise<{ x: number; y: number }>;
  },
  setPosition(point: { x: number; y: number }) {
    ipcRenderer.send('pet-window:set-position', point);
  },
  reportState(state: string) {
    ipcRenderer.send('pet-state:changed', state);
  },
  focusCodex() {
    return ipcRenderer.invoke('pet-window:focus-codex') as Promise<boolean>;
  },
  focusDeepSeek() {
    return ipcRenderer.invoke('pet-window:focus-deepseek') as Promise<boolean>;
  },
});

contextBridge.exposeInMainWorld('codexState', {
  onChange(listener: (snapshot: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on(CODEX_STATE_CHANGED_CHANNEL, handler);
    ipcRenderer.send(CODEX_STATE_READY_CHANNEL);

    return () => ipcRenderer.removeListener(CODEX_STATE_CHANGED_CHANNEL, handler);
  },
});

contextBridge.exposeInMainWorld('deepseekState', {
  onChange(listener: (snapshot: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on(DEEPSEEK_STATE_CHANGED_CHANNEL, handler);
    ipcRenderer.send(DEEPSEEK_STATE_READY_CHANNEL);

    return () => ipcRenderer.removeListener(DEEPSEEK_STATE_CHANGED_CHANNEL, handler);
  },
});
