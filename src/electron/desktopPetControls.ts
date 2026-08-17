import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';

export type PetStateName = 'IDLE' | 'WORKING' | 'WAITING' | 'DONE' | 'ERROR';

type DesktopPetControlsOptions = {
  initialState: PetStateName;
  isPetVisible: () => boolean;
  showPet: () => void;
  hidePet: () => void;
  quitApp: () => void;
};

export type DesktopPetControls = {
  setState: (state: PetStateName) => void;
  refreshMenu: () => void;
  isSummonShortcutRegistered: () => boolean;
  dispose: () => void;
};

const SUMMON_ACCELERATOR = 'CommandOrControl+Alt+C';
const SUMMON_SHORTCUT_LABEL = 'Command + Option + C';
const FALLBACK_CAT_TRAY_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <path fill="#000" d="M5.3 14.2 3.9 3.6l9.2 6.1A15 15 0 0 1 18 8.9c1.7 0 3.4.3 4.9.8l9.2-6.1-1.4 10.6A14.4 14.4 0 0 1 32.4 21c0 7.5-6.4 12.1-14.4 12.1S3.6 28.5 3.6 21c0-2.5.6-4.8 1.7-6.8Z"/>
  </svg>
`;

function createTrayIcon() {
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray', 'catTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(FALLBACK_CAT_TRAY_ICON_SVG).toString('base64')}`;
    icon = nativeImage.createFromDataURL(dataUrl).resize({ width: 18, height: 18 });
    console.warn(`[My Cat Pet] Tray icon asset was not found at ${iconPath}; using fallback.`);
  }

  icon.setTemplateImage(true);
  return icon;
}

function isLoginLaunchEnabled() {
  if (!app.isPackaged || process.platform !== 'darwin') {
    return false;
  }

  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    console.warn('[My Cat Pet] Unable to read login item settings.', error);
    return false;
  }
}

export function createDesktopPetControls(
  options: DesktopPetControlsOptions,
): DesktopPetControls {
  const tray = new Tray(createTrayIcon());
  let currentState = options.initialState;
  let summonShortcutRegistered = false;
  let disposed = false;

  const refreshMenu = () => {
    if (disposed) {
      return;
    }

    const petVisible = options.isPetVisible();
    const contextMenu = Menu.buildFromTemplate([
      { label: 'QiuQiu', enabled: false },
      {
        label:
          currentState === 'WAITING'
            ? '当前状态：WAITING · 等待你的确认'
            : `当前状态：${currentState}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '显示猫咪',
        enabled: !petVisible,
        click: options.showPet,
      },
      {
        label: '隐藏猫咪',
        enabled: petVisible,
        click: options.hidePet,
      },
      { type: 'separator' },
      {
        label: app.isPackaged ? '登录时自动启动' : '登录时自动启动（正式版可用）',
        type: 'checkbox',
        checked: isLoginLaunchEnabled(),
        enabled: app.isPackaged && process.platform === 'darwin',
        click: (menuItem) => {
          if (!app.isPackaged || process.platform !== 'darwin') {
            return;
          }

          try {
            app.setLoginItemSettings({
              openAtLogin: menuItem.checked,
              openAsHidden: false,
              type: 'mainAppService',
            });
          } catch (error) {
            console.warn('[My Cat Pet] Unable to update login item settings.', error);
          }

          refreshMenu();
        },
      },
      { type: 'separator' },
      {
        label: '退出 QiuQiu',
        click: options.quitApp,
      },
    ]);

    tray.setToolTip(`QiuQiu · ${currentState}`);
    tray.setContextMenu(contextMenu);
  };

  tray.setIgnoreDoubleClickEvents(true);
  refreshMenu();

  try {
    summonShortcutRegistered = globalShortcut.register(SUMMON_ACCELERATOR, options.showPet);
  } catch (error) {
    console.warn(
      `[My Cat Pet] Global shortcut registration failed: ${SUMMON_SHORTCUT_LABEL}.`,
      error,
    );
  }

  if (summonShortcutRegistered) {
    console.info(`[My Cat Pet] Global shortcut registered: ${SUMMON_SHORTCUT_LABEL}.`);
  } else {
    console.warn(
      `[My Cat Pet] Global shortcut unavailable: ${SUMMON_SHORTCUT_LABEL} may be in use.`,
    );
  }

  return {
    setState(state) {
      if (currentState === state) {
        return;
      }

      currentState = state;
      refreshMenu();
    },
    refreshMenu,
    isSummonShortcutRegistered() {
      return summonShortcutRegistered;
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      if (summonShortcutRegistered) {
        globalShortcut.unregister(SUMMON_ACCELERATOR);
        summonShortcutRegistered = false;
      }
      tray.destroy();
    },
  };
}
