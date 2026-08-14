import { readFile, unwatchFile, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type DeepSeekAutomaticState = 'IDLE' | 'WORKING' | 'WAITING' | 'DONE' | 'ERROR';

export type DeepSeekStateSnapshot = {
  source: 'deepseek';
  state: DeepSeekAutomaticState;
  sessionId: string;
  turnId?: string;
  updatedAt: number;
  uiUrl?: string;
};

export const DEEPSEEK_STATE_FILE = path.join(
  homedir(),
  '.my-cat-pet',
  'deepseek-state.json',
);

const AUTOMATIC_STATES = new Set<DeepSeekAutomaticState>([
  'IDLE',
  'WORKING',
  'WAITING',
  'DONE',
  'ERROR',
]);

function isSafeLoopbackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function parseSnapshot(value: unknown): DeepSeekStateSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<Record<keyof DeepSeekStateSnapshot, unknown>>;
  if (
    snapshot.source !== 'deepseek' ||
    typeof snapshot.state !== 'string' ||
    !AUTOMATIC_STATES.has(snapshot.state as DeepSeekAutomaticState) ||
    typeof snapshot.sessionId !== 'string' ||
    snapshot.sessionId.length === 0 ||
    snapshot.sessionId.length > 256 ||
    !Number.isFinite(snapshot.updatedAt) ||
    Number(snapshot.updatedAt) <= 0
  ) {
    return null;
  }

  if (
    snapshot.turnId !== undefined &&
    (typeof snapshot.turnId !== 'string' || snapshot.turnId.length > 256)
  ) {
    return null;
  }

  if (snapshot.uiUrl !== undefined && !isSafeLoopbackUrl(snapshot.uiUrl)) {
    return null;
  }

  return {
    source: 'deepseek',
    state: snapshot.state as DeepSeekAutomaticState,
    sessionId: snapshot.sessionId,
    ...(snapshot.turnId ? { turnId: snapshot.turnId } : {}),
    updatedAt: Number(snapshot.updatedAt),
    ...(snapshot.uiUrl ? { uiUrl: snapshot.uiUrl } : {}),
  };
}

export function startDeepSeekStateBridge(onState: (snapshot: DeepSeekStateSnapshot) => void) {
  let stopped = false;
  let reading = false;
  let readAgain = false;
  let lastSignature = '';

  const refresh = () => {
    if (stopped) {
      return;
    }

    if (reading) {
      readAgain = true;
      return;
    }

    reading = true;
    readFile(DEEPSEEK_STATE_FILE, 'utf8', (error, contents) => {
      reading = false;

      if (!error) {
        try {
          const snapshot = parseSnapshot(JSON.parse(contents));
          if (snapshot) {
            const signature = `${snapshot.sessionId}:${snapshot.turnId ?? ''}:${snapshot.state}:${snapshot.updatedAt}:${snapshot.uiUrl ?? ''}`;
            if (signature !== lastSignature) {
              lastSignature = signature;
              onState(snapshot);
            }
          }
        } catch {
          // A malformed or partially written external state must never affect Electron.
        }
      }

      if (readAgain) {
        readAgain = false;
        refresh();
      }
    });
  };

  watchFile(DEEPSEEK_STATE_FILE, { interval: 250, persistent: false }, refresh);
  refresh();

  return () => {
    stopped = true;
    unwatchFile(DEEPSEEK_STATE_FILE, refresh);
  };
}
