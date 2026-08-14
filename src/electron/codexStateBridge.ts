import { readFile, unwatchFile, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type CodexAutomaticState = 'IDLE' | 'WORKING' | 'WAITING' | 'DONE';

export type CodexStateSnapshot = {
  source: 'codex';
  state: CodexAutomaticState;
  sessionId: string;
  turnId?: string;
  updatedAt: number;
};

export const CODEX_STATE_FILE = path.join(homedir(), '.my-cat-pet', 'codex-state.json');

const AUTOMATIC_STATES = new Set<CodexAutomaticState>(['IDLE', 'WORKING', 'WAITING', 'DONE']);

function parseSnapshot(value: unknown): CodexStateSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<Record<keyof CodexStateSnapshot, unknown>>;
  if (
    snapshot.source !== 'codex' ||
    typeof snapshot.state !== 'string' ||
    !AUTOMATIC_STATES.has(snapshot.state as CodexAutomaticState) ||
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

  return {
    source: 'codex',
    state: snapshot.state as CodexAutomaticState,
    sessionId: snapshot.sessionId,
    ...(snapshot.turnId ? { turnId: snapshot.turnId } : {}),
    updatedAt: Number(snapshot.updatedAt),
  };
}

export function startCodexStateBridge(onState: (snapshot: CodexStateSnapshot) => void) {
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
    readFile(CODEX_STATE_FILE, 'utf8', (error, contents) => {
      reading = false;

      if (!error) {
        try {
          const snapshot = parseSnapshot(JSON.parse(contents));
          if (snapshot) {
            const signature = `${snapshot.sessionId}:${snapshot.turnId ?? ''}:${snapshot.state}:${snapshot.updatedAt}`;
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

  watchFile(CODEX_STATE_FILE, { interval: 250, persistent: false }, refresh);
  refresh();

  return () => {
    stopped = true;
    unwatchFile(CODEX_STATE_FILE, refresh);
  };
}
