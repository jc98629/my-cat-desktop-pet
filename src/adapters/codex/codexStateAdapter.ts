import { PetState } from '../../state/PetStateContext';
import { parseCodexStateSnapshot, type CodexAutomaticState } from './types';

const DONE_HOLD_MS = 3_000;

const PET_STATE_BY_CODEX_STATE: Record<CodexAutomaticState, PetState> = {
  IDLE: PetState.IDLE,
  WORKING: PetState.WORKING,
  WAITING: PetState.WAITING,
  DONE: PetState.DONE,
};

export type CodexPetStateUpdate = {
  state: PetState;
  doneHoldMs: number;
};

function adaptCodexState(value: unknown): CodexPetStateUpdate | null {
  const snapshot = parseCodexStateSnapshot(value);
  if (!snapshot) {
    return null;
  }

  if (snapshot.state !== 'DONE') {
    return {
      state: PET_STATE_BY_CODEX_STATE[snapshot.state],
      doneHoldMs: 0,
    };
  }

  const remainingDoneTime = Math.max(0, DONE_HOLD_MS - (Date.now() - snapshot.updatedAt));
  return {
    state: remainingDoneTime > 0 ? PetState.DONE : PetState.IDLE,
    doneHoldMs: remainingDoneTime,
  };
}

export function subscribeToCodexPetState(
  listener: (update: CodexPetStateUpdate) => void,
): () => void {
  if (!window.codexState) {
    return () => undefined;
  }

  return window.codexState.onChange((value) => {
    const update = adaptCodexState(value);
    if (update) {
      listener(update);
    }
  });
}
