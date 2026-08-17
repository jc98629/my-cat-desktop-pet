'use strict';

const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const EVENT_STATE = Object.freeze({
  UserPromptSubmit: 'WORKING',
  PostToolUse: 'WORKING',
  Stop: 'DONE',
});

const STATE_DIR = path.join(os.homedir(), '.my-cat-pet');
const STATE_FILE = path.join(STATE_DIR, 'codex-state.json');
const SESSION_STATE_DIR = path.join(STATE_DIR, 'codex-sessions');
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

async function readHookInput() {
  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
      return null;
    }
  }

  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
}

function sessionStateFile(sessionId) {
  const fileName = createHash('sha256').update(sessionId).digest('hex');
  return path.join(SESSION_STATE_DIR, `${fileName}.json`);
}

async function readCurrentState(stateFile) {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function isDuplicateOrLate(current, next, eventName) {
  if (!current || current.source !== 'codex') {
    return false;
  }

  const sameTurn =
    current.sessionId === next.sessionId &&
    typeof current.turnId === 'string' &&
    current.turnId === next.turnId;

  if (!sameTurn) {
    return false;
  }

  if (current.state === next.state) {
    return true;
  }

  // DONE is terminal for one Codex turn. A late background tool hook must not
  // move that completed turn back to WORKING.
  return current.state === 'DONE' && eventName !== 'UserPromptSubmit';
}

async function writeState(input) {
  const eventName = safeId(input?.hook_event_name);
  const state = eventName ? EVENT_STATE[eventName] : null;
  const sessionId = safeId(input?.session_id);
  const turnId = safeId(input?.turn_id);

  if (!state || !sessionId || !turnId) {
    return;
  }

  const next = {
    source: 'codex',
    state,
    sessionId,
    turnId,
    updatedAt: Date.now(),
  };
  const stateFile = sessionStateFile(sessionId);
  const current = await readCurrentState(stateFile);
  if (isDuplicateOrLate(current, next, eventName)) {
    return;
  }

  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await fs.mkdir(SESSION_STATE_DIR, { recursive: true, mode: 0o700 });

  await writeSnapshot(stateFile, next);
  // Keep the original file as a compatibility view for older builds and
  // external diagnostics. The desktop pet aggregates codex-sessions instead.
  await writeSnapshot(STATE_FILE, next).catch(() => undefined);
}

async function writeSnapshot(stateFile, snapshot) {
  const tempFile = path.join(
    path.dirname(stateFile),
    `.${path.basename(stateFile)}.${process.pid}.tmp`,
  );

  try {
    await fs.writeFile(tempFile, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(tempFile, stateFile);
  } catch {
    await fs.unlink(tempFile).catch(() => undefined);
    throw new Error('state-write-failed');
  }
}

async function main() {
  const input = await readHookInput();
  if (input) {
    await writeState(input).catch(() => undefined);
  }
}

main()
  .catch(() => undefined)
  .finally(() => {
    // Stop hooks require JSON output. An empty object is valid and never steers Codex.
    process.stdout.write('{}');
  });
