export type DeepSeekAutomaticState = 'IDLE' | 'WORKING' | 'WAITING' | 'DONE' | 'ERROR';

export type DeepSeekStateSnapshot = {
  source: 'deepseek';
  state: DeepSeekAutomaticState;
  sessionId: string;
  turnId?: string;
  updatedAt: number;
  uiUrl?: string;
};

const DEEPSEEK_AUTOMATIC_STATES = new Set<DeepSeekAutomaticState>([
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

export function parseDeepSeekStateSnapshot(value: unknown): DeepSeekStateSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<Record<keyof DeepSeekStateSnapshot, unknown>>;
  if (
    snapshot.source !== 'deepseek' ||
    typeof snapshot.state !== 'string' ||
    !DEEPSEEK_AUTOMATIC_STATES.has(snapshot.state as DeepSeekAutomaticState) ||
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
