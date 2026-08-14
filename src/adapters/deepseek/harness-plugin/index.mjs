import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const name = 'my-cat-pet-state-bridge';
export const inject = ['agents', 'webServer'];

const DEFAULT_DONE_HOLD_MS = 3_000;
const WAITING_TOOL_NAMES = new Set(['ask_user_question', 'exit_plan_mode']);
const STATE_PRIORITY = ['ERROR', 'WAITING', 'DONE', 'WORKING', 'IDLE'];

function getAgentId(agent) {
  return String(agent?.id ?? agent?.session?.id ?? 'deepseek-harness');
}

function getSessionId(agent) {
  return String(agent?.session?.id ?? agent?.id ?? 'deepseek-harness');
}

function isRootAgent(ctx, agent) {
  try {
    return ctx.agents.roots().includes(agent);
  } catch {
    return false;
  }
}

function rootForSession(ctx, session) {
  try {
    return ctx.agents.roots().find(
      (agent) => agent?.session === session || agent?.session?.id === session?.id,
    );
  } catch {
    return undefined;
  }
}

function safeUiUrl(ctx) {
  try {
    const port = Number(ctx.webServer?.port);
    return Number.isInteger(port) && port > 0 && port <= 65_535
      ? `http://127.0.0.1:${port}`
      : undefined;
  } catch {
    return undefined;
  }
}

function stateForRoot(root, now) {
  if (root.failed) {
    return 'ERROR';
  }
  if (root.pendingApprovals.size > 0 || root.pendingQuestions.size > 0) {
    return 'WAITING';
  }
  if (root.doneUntil > now) {
    return 'DONE';
  }
  return root.status === 'running' ? 'WORKING' : 'IDLE';
}

function createRootState(agent) {
  return {
    agent,
    status: agent?.status === 'running' ? 'running' : 'idle',
    pendingApprovals: new Set(),
    pendingQuestions: new Set(),
    failed: false,
    doneUntil: 0,
    turnId: undefined,
    changedAt: Date.now(),
    doneTimer: undefined,
  };
}

export function apply(ctx, config = {}) {
  const stateFile =
    typeof config.stateFile === 'string' && config.stateFile.length > 0
      ? config.stateFile
      : path.join(homedir(), '.my-cat-pet', 'deepseek-state.json');
  const doneHoldMs =
    Number.isFinite(config.doneHoldMs) && config.doneHoldMs >= 0
      ? Number(config.doneHoldMs)
      : DEFAULT_DONE_HOLD_MS;
  const roots = new Map();
  let disposed = false;
  let writeScheduled = false;
  let pendingSnapshot;
  let writeChain = Promise.resolve();
  let lastSignature = '';

  const getRootState = (agent) => {
    const agentId = getAgentId(agent);
    let root = roots.get(agentId);
    if (!root) {
      root = createRootState(agent);
      roots.set(agentId, root);
    }
    return root;
  };

  const chooseSnapshot = () => {
    const now = Date.now();
    const candidates = [...roots.values()].map((root) => ({
      root,
      state: stateForRoot(root, now),
    }));
    const chosenState =
      STATE_PRIORITY.find((state) => candidates.some((candidate) => candidate.state === state)) ??
      'IDLE';
    const chosen = candidates
      .filter((candidate) => candidate.state === chosenState)
      .sort((left, right) => right.root.changedAt - left.root.changedAt)[0];
    const root = chosen?.root;
    const uiUrl = safeUiUrl(ctx);

    return {
      source: 'deepseek',
      state: chosenState,
      sessionId: root ? getSessionId(root.agent) : 'deepseek-harness',
      ...(root?.turnId ? { turnId: root.turnId } : {}),
      updatedAt: now,
      ...(uiUrl ? { uiUrl } : {}),
    };
  };

  const enqueueSnapshot = (snapshot, force = false) => {
    if (disposed && !force) {
      return;
    }

    const signature = JSON.stringify({
      state: snapshot.state,
      sessionId: snapshot.sessionId,
      turnId: snapshot.turnId,
      uiUrl: snapshot.uiUrl,
    });
    if (!force && signature === lastSignature) {
      return;
    }
    lastSignature = signature;
    pendingSnapshot = snapshot;

    if (writeScheduled) {
      return;
    }
    writeScheduled = true;

    queueMicrotask(() => {
      writeScheduled = false;
      const latest = pendingSnapshot;
      pendingSnapshot = undefined;
      if (!latest) {
        return;
      }

      writeChain = writeChain
        .then(async () => {
          const directory = path.dirname(stateFile);
          const temporaryFile = path.join(
            directory,
            `.${path.basename(stateFile)}.${process.pid}.tmp`,
          );
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await writeFile(temporaryFile, `${JSON.stringify(latest, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
          });
          await rename(temporaryFile, stateFile);
        })
        .catch(() => {
          // Desktop-pet state reporting must never affect DeepSeek Harness.
        })
        .finally(() => {
          if (pendingSnapshot) {
            enqueueSnapshot(pendingSnapshot, true);
          }
        });
    });
  };

  const publish = () => enqueueSnapshot(chooseSnapshot());

  const scheduleDoneExpiry = (root) => {
    clearTimeout(root.doneTimer);
    const delay = Math.max(0, root.doneUntil - Date.now());
    root.doneTimer = setTimeout(() => {
      root.doneTimer = undefined;
      root.changedAt = Date.now();
      publish();
    }, delay + 5);
  };

  const safely = (listener) => (...args) => {
    try {
      listener(...args);
    } catch {
      // Event observation is deliberately fail-soft.
    }
  };

  for (const agent of ctx.agents.roots()) {
    getRootState(agent);
  }
  publish();

  ctx.on(
    'agent/created',
    safely(({ agent }) => {
      if (!isRootAgent(ctx, agent)) {
        return;
      }
      getRootState(agent);
      publish();
    }),
  );

  ctx.on(
    'agent/disposed',
    safely(({ agent }) => {
      const root = roots.get(getAgentId(agent));
      if (!root) {
        return;
      }
      clearTimeout(root.doneTimer);
      roots.delete(getAgentId(agent));
      publish();
    }),
  );

  ctx.on(
    'agent/status',
    safely(({ agent, status }) => {
      if (!isRootAgent(ctx, agent)) {
        return;
      }
      const root = getRootState(agent);
      root.status = status === 'running' ? 'running' : 'idle';
      root.changedAt = Date.now();
      if (root.status === 'running') {
        root.failed = false;
        root.doneUntil = 0;
        clearTimeout(root.doneTimer);
        root.doneTimer = undefined;
      }
      publish();
    }),
  );

  ctx.on(
    'session/event',
    safely((session, event) => {
      const agent = rootForSession(ctx, session);
      if (!agent) {
        return;
      }
      const root = getRootState(agent);
      root.changedAt = Date.now();

      if (event.type === 'turn/start') {
        root.turnId = String(event.data.turn);
        root.failed = false;
        root.doneUntil = 0;
        root.pendingApprovals.clear();
        root.pendingQuestions.clear();
        clearTimeout(root.doneTimer);
        root.doneTimer = undefined;
      } else if (event.type === 'approval/asked') {
        root.pendingApprovals.add(String(event.data.id));
      } else if (event.type === 'approval/decided') {
        root.pendingApprovals.delete(String(event.data.id));
      } else if (
        event.type === 'tool/call' &&
        WAITING_TOOL_NAMES.has(event.data.name)
      ) {
        root.pendingQuestions.add(String(event.data.callId));
      } else if (event.type === 'tool/result') {
        const toolCallId = event.data.message?.content?.[0]?.toolCallId;
        if (toolCallId !== undefined) {
          root.pendingQuestions.delete(String(toolCallId));
        }
      } else if (event.type === 'turn/end') {
        root.pendingApprovals.clear();
        root.pendingQuestions.clear();
        const reason = event.data.reason?.kind;
        if (reason === 'error') {
          root.failed = true;
          root.doneUntil = 0;
          clearTimeout(root.doneTimer);
          root.doneTimer = undefined;
        } else if (reason === 'completed' || reason === 'max-tokens') {
          root.failed = false;
          root.doneUntil = Date.now() + doneHoldMs;
          scheduleDoneExpiry(root);
        } else {
          root.failed = false;
          root.doneUntil = 0;
          clearTimeout(root.doneTimer);
          root.doneTimer = undefined;
        }
      }

      publish();
    }),
  );

  ctx.effect(
    () => () => {
      disposed = true;
      for (const root of roots.values()) {
        clearTimeout(root.doneTimer);
      }
      enqueueSnapshot(
        {
          source: 'deepseek',
          state: 'IDLE',
          sessionId: 'deepseek-harness',
          updatedAt: Date.now(),
          ...(safeUiUrl(ctx) ? { uiUrl: safeUiUrl(ctx) } : {}),
        },
        true,
      );
    },
    'my-cat-pet state bridge cleanup',
  );
}
