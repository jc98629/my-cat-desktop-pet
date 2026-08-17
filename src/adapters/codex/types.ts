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

const CODEX_AUTOMATIC_STATES = new Set<CodexAutomaticState>([
  'IDLE',
  'WORKING',
  'WAITING',
  'DONE',
]);

export function parseCodexStateSnapshot(value: unknown): CodexStateSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<Record<keyof CodexStateSnapshot, unknown>>;
  if (
    snapshot.source !== 'codex' ||
    typeof snapshot.state !== 'string' ||
    !CODEX_AUTOMATIC_STATES.has(snapshot.state as CodexAutomaticState) ||
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

  if (
    snapshot.resumeState !== undefined &&
    snapshot.resumeState !== 'IDLE' &&
    snapshot.resumeState !== 'WORKING'
  ) {
    return null;
  }

  return {
    source: 'codex',
    state: snapshot.state as CodexAutomaticState,
    sessionId: snapshot.sessionId,
    ...(snapshot.turnId ? { turnId: snapshot.turnId } : {}),
    updatedAt: Number(snapshot.updatedAt),
    ...(snapshot.resumeState ? { resumeState: snapshot.resumeState as CodexDoneResumeState } : {}),
  };
}
