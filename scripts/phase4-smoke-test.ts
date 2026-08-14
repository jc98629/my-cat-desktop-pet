import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adaptDeepSeekState } from '../src/adapters/deepseek';
import { PetState } from '../src/state/PetStateContext';
import { aggregatePetStates } from '../src/state/stateAggregator';

type Listener = (...args: any[]) => void;

async function eventually<T>(read: () => Promise<T>, accepts: (value: T) => boolean) {
  const deadline = Date.now() + 1_000;
  let value = await read();
  while (!accepts(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = await read();
  }
  return value;
}

function verifyAggregator() {
  const cases = [
    [PetState.IDLE, PetState.WORKING, PetState.WORKING, 'deepseek'],
    [PetState.WORKING, PetState.WAITING, PetState.WAITING, 'deepseek'],
    [PetState.WAITING, PetState.WORKING, PetState.WAITING, 'codex'],
    [PetState.WORKING, PetState.DONE, PetState.DONE, 'deepseek'],
    [PetState.WORKING, PetState.ERROR, PetState.ERROR, 'deepseek'],
    [PetState.WAITING, PetState.WAITING, PetState.WAITING, 'both'],
  ] as const;

  for (const [codex, deepseek, expectedState, expectedSource] of cases) {
    const actual = aggregatePetStates({ codex, deepseek });
    assert.equal(actual.state, expectedState);
    assert.equal(actual.source, expectedSource);
  }
}

function verifyAdapter() {
  assert.deepEqual(
    adaptDeepSeekState({
      source: 'deepseek',
      state: 'WORKING',
      sessionId: 'session-1',
      updatedAt: Date.now(),
    }),
    { state: PetState.WORKING, doneHoldMs: 0 },
  );
  assert.equal(
    adaptDeepSeekState({
      source: 'deepseek',
      state: 'DONE',
      sessionId: 'session-1',
      updatedAt: Date.now() - 4_000,
    })?.state,
    PetState.IDLE,
  );
  assert.equal(
    adaptDeepSeekState({
      source: 'deepseek',
      state: 'ERROR',
      sessionId: 'session-1',
      updatedAt: Date.now(),
      uiUrl: 'https://example.com',
    }),
    null,
  );
}

async function verifyHarnessPlugin() {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'my-cat-phase4-'));
  const stateFile = path.join(temporaryDirectory, 'deepseek-state.json');
  const pluginUrl = pathToFileURL(
    path.resolve('src/adapters/deepseek/harness-plugin/index.mjs'),
  ).href;
  const { apply } = await import(pluginUrl);
  const listeners = new Map<string, Listener[]>();
  const cleanups: Array<() => void> = [];
  const session = { id: 'deepseek-session-1' };
  const agent = { id: 'deepseek-session-1', status: 'idle', session };
  const roots = [agent];
  const ctx = {
    agents: { roots: () => [...roots] },
    webServer: { port: 42_123 },
    on(event: string, listener: Listener) {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return () => undefined;
    },
    effect(register: () => () => void) {
      cleanups.push(register());
      return () => undefined;
    },
  };
  const emit = (event: string, ...args: any[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };
  const readState = async () => {
    try {
      return JSON.parse(await readFile(stateFile, 'utf8')) as {
        state: string;
        uiUrl?: string;
      };
    } catch {
      return { state: '' };
    }
  };
  const waitForState = async (state: string) =>
    eventually(readState, (snapshot) => snapshot.state === state);

  try {
    apply(ctx, { stateFile, doneHoldMs: 35 });
    assert.equal((await waitForState('IDLE')).uiUrl, 'http://127.0.0.1:42123');

    emit('agent/status', { agent, status: 'running' });
    assert.equal((await waitForState('WORKING')).state, 'WORKING');

    emit('session/event', session, {
      type: 'approval/asked',
      data: { id: 'approval-1' },
    });
    assert.equal((await waitForState('WAITING')).state, 'WAITING');
    emit('session/event', session, {
      type: 'approval/decided',
      data: { id: 'approval-1' },
    });
    assert.equal((await waitForState('WORKING')).state, 'WORKING');

    emit('session/event', session, {
      type: 'tool/call',
      data: { callId: 'question-1', name: 'ask_user_question' },
    });
    assert.equal((await waitForState('WAITING')).state, 'WAITING');
    emit('session/event', session, {
      type: 'tool/result',
      data: { message: { content: [{ toolCallId: 'question-1', isError: false }] } },
    });
    assert.equal((await waitForState('WORKING')).state, 'WORKING');

    emit('session/event', session, {
      type: 'tool/result',
      data: { message: { content: [{ toolCallId: 'ordinary-tool', isError: true }] } },
    });
    assert.equal((await waitForState('WORKING')).state, 'WORKING');

    emit('session/event', session, {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    });
    emit('agent/status', { agent, status: 'idle' });
    assert.equal((await waitForState('DONE')).state, 'DONE');
    assert.equal((await waitForState('IDLE')).state, 'IDLE');

    emit('agent/status', { agent, status: 'running' });
    emit('session/event', session, { type: 'turn/start', data: { turn: 2 } });
    emit('session/event', session, {
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    });
    emit('agent/status', { agent, status: 'idle' });
    assert.equal((await waitForState('ERROR')).state, 'ERROR');
  } finally {
    for (const cleanup of cleanups) {
      cleanup();
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

verifyAggregator();
verifyAdapter();
await verifyHarnessPlugin();
console.log('Phase 4.1 smoke tests passed.');
