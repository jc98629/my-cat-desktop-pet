import { promises as fs, unwatchFile, watchFile } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  startCodexRuntimeStatusBridge,
  type CodexRuntimeSessionState,
} from './codexRuntimeStatusBridge';

export type CodexAutomaticState = 'IDLE' | 'WORKING' | 'WAITING' | 'DONE';
export type CodexDoneResumeState = 'IDLE' | 'WORKING';

export type CodexStateSnapshot = {
  source: 'codex';
  state: CodexAutomaticState;
  sessionId: string;
  turnId?: string;
  updatedAt: number;
  resumeState?: CodexDoneResumeState;
};

export type CodexAggregationResult = {
  snapshot: CodexStateSnapshot | null;
  nextRefreshMs: number | null;
};

export const CODEX_STATE_DIR = path.join(homedir(), '.my-cat-pet');
export const CODEX_STATE_FILE = path.join(CODEX_STATE_DIR, 'codex-state.json');
export const CODEX_SESSION_STATE_DIR = path.join(CODEX_STATE_DIR, 'codex-sessions');

const AUTOMATIC_STATES = new Set<CodexAutomaticState>(['IDLE', 'WORKING', 'WAITING', 'DONE']);
const DONE_HOLD_MS = 3_000;
const UNKNOWN_RUNTIME_WORKING_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

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

function newestSnapshot(snapshots: CodexStateSnapshot[]) {
  return snapshots.reduce<CodexStateSnapshot | null>(
    (latest, snapshot) => (!latest || snapshot.updatedAt > latest.updatedAt ? snapshot : latest),
    null,
  );
}

export function aggregateCodexSessions(
  snapshots: Iterable<CodexStateSnapshot>,
  runtimeStates: ReadonlyMap<string, CodexRuntimeSessionState> = new Map(),
  completionObservedAt: ReadonlyMap<string, number> = new Map(),
  now = Date.now(),
): CodexAggregationResult {
  const waiting: CodexStateSnapshot[] = [];
  const working: CodexStateSnapshot[] = [];
  const done: Array<{ snapshot: CodexStateSnapshot; completedAt: number }> = [];
  const inactive: CodexStateSnapshot[] = [];
  let nextRefreshAt: number | null = null;

  for (const snapshot of snapshots) {
    const runtime = runtimeStates.get(snapshot.sessionId);

    if (runtime?.waiting) {
      waiting.push({
        ...snapshot,
        state: 'WAITING',
        updatedAt: Math.max(snapshot.updatedAt, runtime.observedAt),
      });
      continue;
    }

    if (runtime?.active === true) {
      working.push({
        ...snapshot,
        state: 'WORKING',
        updatedAt: Math.max(snapshot.updatedAt, runtime.observedAt),
      });
      continue;
    }

    if (snapshot.state === 'DONE') {
      const completedAt = Math.max(
        snapshot.updatedAt,
        completionObservedAt.get(snapshot.sessionId) ?? 0,
      );
      const expiresAt = completedAt + DONE_HOLD_MS;
      if (expiresAt > now) {
        done.push({ snapshot, completedAt });
        nextRefreshAt = nextRefreshAt === null ? expiresAt : Math.min(nextRefreshAt, expiresAt);
      } else {
        inactive.push(snapshot);
      }
      continue;
    }

    if (snapshot.state === 'WORKING' || snapshot.state === 'WAITING') {
      if (runtime?.active === false) {
        inactive.push(snapshot);
        continue;
      }

      const staleAt = snapshot.updatedAt + UNKNOWN_RUNTIME_WORKING_MAX_AGE_MS;
      if (staleAt > now) {
        working.push({ ...snapshot, state: 'WORKING' });
        nextRefreshAt = nextRefreshAt === null ? staleAt : Math.min(nextRefreshAt, staleAt);
      } else {
        inactive.push(snapshot);
      }
      continue;
    }

    inactive.push(snapshot);
  }

  const latestWaiting = newestSnapshot(waiting);
  if (latestWaiting) {
    return {
      snapshot: latestWaiting,
      nextRefreshMs: nextRefreshAt === null ? null : Math.max(1, nextRefreshAt - now),
    };
  }

  if (done.length > 0) {
    const latestDone = done.reduce((latest, candidate) =>
      candidate.completedAt > latest.completedAt ? candidate : latest,
    );
    return {
      snapshot: {
        ...latestDone.snapshot,
        state: 'DONE',
        updatedAt: latestDone.completedAt,
        resumeState: working.length > 0 ? 'WORKING' : 'IDLE',
      },
      nextRefreshMs: nextRefreshAt === null ? null : Math.max(1, nextRefreshAt - now),
    };
  }

  const latestWorking = newestSnapshot(working);
  if (latestWorking) {
    return {
      snapshot: latestWorking,
      nextRefreshMs: nextRefreshAt === null ? null : Math.max(1, nextRefreshAt - now),
    };
  }

  const latestInactive = newestSnapshot(inactive);
  return {
    snapshot: latestInactive
      ? {
          ...latestInactive,
          state: 'IDLE',
          updatedAt: latestInactive.updatedAt,
        }
      : null,
    nextRefreshMs: null,
  };
}

async function readSnapshotFile(filePath: string) {
  try {
    return parseSnapshot(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return null;
  }
}

async function readAllSnapshots() {
  let sessionFiles: string[] = [];
  try {
    const entries = await fs.readdir(CODEX_SESSION_STATE_DIR, { withFileTypes: true });
    sessionFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(CODEX_SESSION_STATE_DIR, entry.name));
  } catch {
    // The directory is created by the first lifecycle event.
  }

  const parsed = await Promise.all([
    ...sessionFiles.map((filePath) => readSnapshotFile(filePath)),
    readSnapshotFile(CODEX_STATE_FILE),
  ]);
  const bySession = new Map<string, CodexStateSnapshot>();
  for (const snapshot of parsed) {
    if (!snapshot) {
      continue;
    }
    const current = bySession.get(snapshot.sessionId);
    if (!current || snapshot.updatedAt >= current.updatedAt) {
      bySession.set(snapshot.sessionId, snapshot);
    }
  }

  return bySession;
}

export function startCodexStateBridge(onState: (snapshot: CodexStateSnapshot) => void) {
  let stopped = false;
  let reading = false;
  let readAgain = false;
  let lastSignature = '';
  let aggregationTimer: NodeJS.Timeout | undefined;
  let latestSnapshots = new Map<string, CodexStateSnapshot>();
  const runtimeStates = new Map<string, CodexRuntimeSessionState>();
  const completionObservedAt = new Map<string, number>();

  const publish = (snapshot: CodexStateSnapshot) => {
    const signature = [
      snapshot.sessionId,
      snapshot.turnId ?? '',
      snapshot.state,
      snapshot.updatedAt,
      snapshot.resumeState ?? '',
    ].join(':');
    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    onState(snapshot);
  };

  const recompute = () => {
    if (stopped) {
      return;
    }

    if (aggregationTimer) {
      clearTimeout(aggregationTimer);
      aggregationTimer = undefined;
    }

    const result = aggregateCodexSessions(
      latestSnapshots.values(),
      runtimeStates,
      completionObservedAt,
    );
    if (result.snapshot) {
      publish(result.snapshot);
    }
    if (result.nextRefreshMs !== null) {
      aggregationTimer = setTimeout(recompute, Math.ceil(result.nextRefreshMs));
    }
  };

  const runtimeBridge = startCodexRuntimeStatusBridge((sessionId, state) => {
    const previous = runtimeStates.get(sessionId);
    if (previous?.active === true && state.active === false) {
      completionObservedAt.set(sessionId, state.observedAt);
    } else if (state.active === true) {
      completionObservedAt.delete(sessionId);
    }
    runtimeStates.set(sessionId, state);
    recompute();
  });

  const refresh = async () => {
    if (stopped) {
      return;
    }

    if (reading) {
      readAgain = true;
      return;
    }

    reading = true;
    latestSnapshots = await readAllSnapshots();
    reading = false;
    runtimeBridge.followSessions(latestSnapshots.keys());
    recompute();

    if (readAgain) {
      readAgain = false;
      void refresh();
    }
  };

  watchFile(CODEX_SESSION_STATE_DIR, { interval: 250, persistent: false }, refresh);
  watchFile(CODEX_STATE_FILE, { interval: 250, persistent: false }, refresh);
  void refresh();

  return () => {
    stopped = true;
    if (aggregationTimer) {
      clearTimeout(aggregationTimer);
      aggregationTimer = undefined;
    }
    runtimeBridge.stop();
    unwatchFile(CODEX_SESSION_STATE_DIR, refresh);
    unwatchFile(CODEX_STATE_FILE, refresh);
  };
}
