import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const INITIALIZE_METHOD = 'initialize';
const FOLLOWING_METHOD = 'thread-stream-following-changed';
const STATE_CHANGED_METHOD = 'thread-stream-state-changed';
const FOLLOWING_VERSION = 1;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const RECONNECT_DELAY_MS = 2_000;

type RuntimeStatus = {
  type?: unknown;
  activeFlags?: unknown;
};

type IpcMessage = {
  type?: unknown;
  requestId?: unknown;
  resultType?: unknown;
  method?: unknown;
  result?: unknown;
  params?: unknown;
};

export type CodexRuntimeSessionState = {
  active: boolean | null;
  waiting: boolean;
  observedAt: number;
};

type RuntimeStateListener = (sessionId: string, state: CodexRuntimeSessionState) => void;

type BridgeOptions = {
  socketPaths?: string[];
  reconnectDelayMs?: number;
};

function defaultSocketPaths() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const candidates = [
    path.join(homedir(), '.codex', 'ipc', 'ipc.sock'),
    path.join(tmpdir(), 'codex-ipc', uid ? `ipc-${uid}.sock` : 'ipc.sock'),
  ];

  return [...new Set(candidates)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function runtimeStateFromStatus(status: RuntimeStatus | null): CodexRuntimeSessionState {
  const active = status ? status.type === 'active' : null;
  const waiting =
    active === true &&
    Array.isArray(status?.activeFlags) &&
    status.activeFlags.some(
      (flag) => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput',
    );

  return { active, waiting, observedAt: Date.now() };
}

function runtimeStatusFromSnapshot(value: unknown): RuntimeStatus | null {
  if (!isRecord(value) || !isRecord(value.threadRuntimeStatus)) {
    return null;
  }

  return { ...value.threadRuntimeStatus };
}

function applyRuntimeStatusPatches(
  current: RuntimeStatus | null,
  patches: unknown,
): RuntimeStatus | null {
  if (!Array.isArray(patches)) {
    return current;
  }

  let next: unknown = current ? structuredClone(current) : null;

  for (const candidate of patches) {
    if (!isRecord(candidate) || !Array.isArray(candidate.path)) {
      continue;
    }

    const pathParts = candidate.path;
    if (pathParts[0] !== 'threadRuntimeStatus') {
      continue;
    }

    const relativePath = pathParts.slice(1);
    if (relativePath.length === 0) {
      next = candidate.op === 'remove' ? null : candidate.value;
      continue;
    }

    if (!isRecord(next)) {
      next = {};
    }

    let parent = next as Record<string, unknown> | unknown[];
    for (const part of relativePath.slice(0, -1)) {
      const key = String(part);
      const existing = Array.isArray(parent) ? parent[Number(key)] : parent[key];
      if (!isRecord(existing) && !Array.isArray(existing)) {
        const replacement: Record<string, unknown> = {};
        if (Array.isArray(parent)) {
          parent[Number(key)] = replacement;
        } else {
          parent[key] = replacement;
        }
        parent = replacement;
      } else {
        parent = existing;
      }
    }

    const finalKey = String(relativePath.at(-1));
    if (candidate.op === 'remove') {
      if (Array.isArray(parent)) {
        parent.splice(Number(finalKey), 1);
      } else {
        delete parent[finalKey];
      }
    } else if (candidate.op === 'add' && Array.isArray(parent)) {
      parent.splice(Number(finalKey), 0, candidate.value);
    } else if (candidate.op === 'add' || candidate.op === 'replace') {
      if (Array.isArray(parent)) {
        parent[Number(finalKey)] = candidate.value;
      } else {
        parent[finalKey] = candidate.value;
      }
    }
  }

  return isRecord(next) ? (next as RuntimeStatus) : null;
}

export function startCodexRuntimeStatusBridge(
  onRuntimeState: RuntimeStateListener,
  options: BridgeOptions = {},
) {
  const socketPaths = options.socketPaths ?? defaultSocketPaths();
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  const requestedSessionIds = new Set<string>();
  const followedSessionIds = new Set<string>();
  const runtimeStatuses = new Map<string, RuntimeStatus | null>();
  const lastPublishedSignatures = new Map<string, string>();
  let stopped = false;
  let socket: net.Socket | null = null;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let nextSocketPathIndex = 0;
  let frameBuffer = Buffer.alloc(0);
  let clientId: string | null = null;

  const send = (message: Record<string, unknown>) => {
    if (!socket?.writable) {
      return;
    }

    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    socket.write(Buffer.concat([header, payload]));
  };

  const sendFollowing = (sessionId: string, following: boolean) => {
    if (!clientId) {
      return;
    }

    send({
      type: 'broadcast',
      method: FOLLOWING_METHOD,
      sourceClientId: clientId,
      version: FOLLOWING_VERSION,
      params: {
        conversationId: sessionId,
        hostId: 'local',
        following,
      },
    });
  };

  const syncFollowingSessions = () => {
    if (!clientId) {
      return;
    }

    for (const sessionId of [...followedSessionIds]) {
      if (!requestedSessionIds.has(sessionId)) {
        sendFollowing(sessionId, false);
        followedSessionIds.delete(sessionId);
        runtimeStatuses.delete(sessionId);
        lastPublishedSignatures.delete(sessionId);
      }
    }

    for (const sessionId of requestedSessionIds) {
      if (!followedSessionIds.has(sessionId)) {
        followedSessionIds.add(sessionId);
        sendFollowing(sessionId, true);
      }
    }
  };

  const publishRuntimeStatus = (sessionId: string) => {
    const state = runtimeStateFromStatus(runtimeStatuses.get(sessionId) ?? null);
    const signature = `${String(state.active)}:${String(state.waiting)}`;
    if (lastPublishedSignatures.get(sessionId) === signature) {
      return;
    }

    lastPublishedSignatures.set(sessionId, signature);
    onRuntimeState(sessionId, state);
  };

  const handleStateBroadcast = (message: IpcMessage) => {
    if (message.type !== 'broadcast' || message.method !== STATE_CHANGED_METHOD) {
      return;
    }

    const params = isRecord(message.params) ? message.params : null;
    const sessionId = params?.conversationId;
    if (
      !params ||
      params.hostId !== 'local' ||
      typeof sessionId !== 'string' ||
      !followedSessionIds.has(sessionId) ||
      !isRecord(params.change)
    ) {
      return;
    }

    if (params.change.type === 'snapshot') {
      runtimeStatuses.set(sessionId, runtimeStatusFromSnapshot(params.change.conversationState));
    } else if (params.change.type === 'patches') {
      runtimeStatuses.set(
        sessionId,
        applyRuntimeStatusPatches(runtimeStatuses.get(sessionId) ?? null, params.change.patches),
      );
    } else {
      return;
    }

    publishRuntimeStatus(sessionId);
  };

  const handleMessage = (message: IpcMessage) => {
    if (message.type === 'client-discovery-request' && typeof message.requestId === 'string') {
      send({
        type: 'client-discovery-response',
        requestId: message.requestId,
        response: { canHandle: false },
      });
      return;
    }

    if (
      message.type === 'response' &&
      message.resultType === 'success' &&
      message.method === INITIALIZE_METHOD &&
      isRecord(message.result) &&
      typeof message.result.clientId === 'string'
    ) {
      clientId = message.result.clientId;
      syncFollowingSessions();
      return;
    }

    handleStateBroadcast(message);
  };

  const handleData = (chunk: Buffer) => {
    frameBuffer = Buffer.concat([frameBuffer, chunk]);

    while (frameBuffer.length >= 4) {
      const frameLength = frameBuffer.readUInt32LE(0);
      if (frameLength === 0 || frameLength > MAX_FRAME_BYTES) {
        socket?.destroy();
        return;
      }
      if (frameBuffer.length < frameLength + 4) {
        return;
      }

      const payload = frameBuffer.subarray(4, frameLength + 4);
      frameBuffer = frameBuffer.subarray(frameLength + 4);
      try {
        handleMessage(JSON.parse(payload.toString('utf8')) as IpcMessage);
      } catch {
        socket?.destroy();
        return;
      }
    }
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, reconnectDelayMs);
  };

  const connect = () => {
    if (stopped || socket) {
      return;
    }

    let socketPath: string | undefined;
    let socketPathIndex = -1;
    for (let offset = 0; offset < socketPaths.length; offset += 1) {
      const candidateIndex = (nextSocketPathIndex + offset) % socketPaths.length;
      const candidate = socketPaths[candidateIndex];
      if (candidate && existsSync(candidate)) {
        socketPath = candidate;
        socketPathIndex = candidateIndex;
        break;
      }
    }
    if (!socketPath) {
      scheduleReconnect();
      return;
    }

    const nextSocket = net.createConnection(socketPath);
    socket = nextSocket;
    frameBuffer = Buffer.alloc(0);
    clientId = null;
    followedSessionIds.clear();
    runtimeStatuses.clear();
    lastPublishedSignatures.clear();

    nextSocket.once('connect', () => {
      send({
        type: 'request',
        requestId: randomUUID(),
        method: INITIALIZE_METHOD,
        params: { clientType: 'qiuqiu-runtime-status' },
      });
    });
    nextSocket.on('data', handleData);
    nextSocket.on('error', () => undefined);
    nextSocket.once('close', () => {
      if (socket === nextSocket) {
        socket = null;
      }
      if (socketPaths.length > 1 && socketPathIndex >= 0) {
        nextSocketPathIndex = (socketPathIndex + 1) % socketPaths.length;
      }

      if (!stopped) {
        for (const sessionId of requestedSessionIds) {
          onRuntimeState(sessionId, {
            active: null,
            waiting: false,
            observedAt: Date.now(),
          });
        }
      }
      scheduleReconnect();
    });
  };

  connect();

  return {
    followSessions(sessionIds: Iterable<string>) {
      const nextSessionIds = new Set(
        [...sessionIds].filter((sessionId) => sessionId.length > 0 && sessionId.length <= 256),
      );
      requestedSessionIds.clear();
      for (const sessionId of nextSessionIds) {
        requestedSessionIds.add(sessionId);
      }
      syncFollowingSessions();
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      for (const sessionId of followedSessionIds) {
        sendFollowing(sessionId, false);
      }
      socket?.destroy();
      socket = null;
    },
  };
}
