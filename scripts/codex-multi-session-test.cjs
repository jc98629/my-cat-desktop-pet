'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { aggregateCodexSessions } = require('../dist-electron/codexStateBridge.js');

const NOW = 2_000_000_000_000;

function snapshot(sessionId, state, updatedAt = NOW) {
  return {
    source: 'codex',
    state,
    sessionId,
    turnId: `turn-${sessionId}`,
    updatedAt,
  };
}

function runtime(active, waiting = false, observedAt = NOW) {
  return { active, waiting, observedAt };
}

function verifyAggregation() {
  const oneWorkingOneDone = [snapshot('running', 'WORKING'), snapshot('finished', 'DONE')];
  const mixedRuntime = new Map([
    ['running', runtime(true)],
    ['finished', runtime(false)],
  ]);

  const intermediateDone = aggregateCodexSessions(oneWorkingOneDone, mixedRuntime, new Map(), NOW);
  assert.equal(intermediateDone.snapshot?.state, 'DONE');
  assert.equal(intermediateDone.snapshot?.resumeState, 'WORKING');
  assert.equal(intermediateDone.nextRefreshMs, 3_000);

  const resumed = aggregateCodexSessions(oneWorkingOneDone, mixedRuntime, new Map(), NOW + 3_001);
  assert.equal(resumed.snapshot?.state, 'WORKING');

  const allDone = [snapshot('running', 'DONE', NOW + 4_000), snapshot('finished', 'DONE')];
  const inactiveRuntime = new Map([
    ['running', runtime(false, false, NOW + 4_000)],
    ['finished', runtime(false)],
  ]);
  const finalDone = aggregateCodexSessions(allDone, inactiveRuntime, new Map(), NOW + 4_000);
  assert.equal(finalDone.snapshot?.state, 'DONE');
  assert.equal(finalDone.snapshot?.resumeState, 'IDLE');

  const finalIdle = aggregateCodexSessions(allDone, inactiveRuntime, new Map(), NOW + 7_001);
  assert.equal(finalIdle.snapshot?.state, 'IDLE');

  const waitingWins = aggregateCodexSessions(
    [snapshot('waiting', 'WORKING'), snapshot('finished', 'DONE')],
    new Map([
      ['waiting', runtime(true, true)],
      ['finished', runtime(false)],
    ]),
    new Map(),
    NOW,
  );
  assert.equal(waitingWins.snapshot?.state, 'WAITING');

  const earlyStop = aggregateCodexSessions(
    [snapshot('still-running', 'DONE')],
    new Map([['still-running', runtime(true)]]),
    new Map(),
    NOW,
  );
  assert.equal(earlyStop.snapshot?.state, 'WORKING');
}

async function verifyPerSessionHookFiles() {
  const temporaryHome = await mkdtemp(path.join(tmpdir(), 'qiuqiu-codex-hook-'));
  const hookPath = path.resolve('src/adapters/codex/codex-state-hook.cjs');
  const runHook = (hook_event_name, session_id, turn_id) => {
    const result = spawnSync(process.execPath, [hookPath], {
      encoding: 'utf8',
      env: { ...process.env, HOME: temporaryHome },
      input: JSON.stringify({ hook_event_name, session_id, turn_id }),
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
  };
  const sessionFile = (sessionId) =>
    path.join(
      temporaryHome,
      '.my-cat-pet',
      'codex-sessions',
      `${createHash('sha256').update(sessionId).digest('hex')}.json`,
    );

  try {
    runHook('UserPromptSubmit', 'session-a', 'turn-a');
    runHook('UserPromptSubmit', 'session-b', 'turn-b');
    runHook('Stop', 'session-a', 'turn-a');

    const sessionA = JSON.parse(await readFile(sessionFile('session-a'), 'utf8'));
    const sessionB = JSON.parse(await readFile(sessionFile('session-b'), 'utf8'));
    assert.equal(sessionA.state, 'DONE');
    assert.equal(sessionB.state, 'WORKING');
    assert.equal(sessionA.sessionId, 'session-a');
    assert.equal(sessionB.sessionId, 'session-b');
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
}

verifyAggregation();
verifyPerSessionHookFiles()
  .then(() => console.log('Codex multi-session tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
