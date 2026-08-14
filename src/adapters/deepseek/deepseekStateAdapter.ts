import { PetState } from '../../state/PetStateContext';
import { parseDeepSeekStateSnapshot, type DeepSeekAutomaticState } from './types';

const DONE_HOLD_MS = 3_000;

const PET_STATE_BY_DEEPSEEK_STATE: Record<DeepSeekAutomaticState, PetState> = {
  IDLE: PetState.IDLE,
  WORKING: PetState.WORKING,
  WAITING: PetState.WAITING,
  DONE: PetState.DONE,
  ERROR: PetState.ERROR,
};

export type DeepSeekPetStateUpdate = {
  state: PetState;
  doneHoldMs: number;
};

export function adaptDeepSeekState(value: unknown): DeepSeekPetStateUpdate | null {
  const snapshot = parseDeepSeekStateSnapshot(value);
  if (!snapshot) {
    return null;
  }

  if (snapshot.state !== 'DONE') {
    return {
      state: PET_STATE_BY_DEEPSEEK_STATE[snapshot.state],
      doneHoldMs: 0,
    };
  }

  const remainingDoneTime = Math.max(0, DONE_HOLD_MS - (Date.now() - snapshot.updatedAt));
  return {
    state: remainingDoneTime > 0 ? PetState.DONE : PetState.IDLE,
    doneHoldMs: remainingDoneTime,
  };
}

export function subscribeToDeepSeekPetState(
  listener: (update: DeepSeekPetStateUpdate) => void,
): () => void {
  if (!window.deepseekState) {
    return () => undefined;
  }

  return window.deepseekState.onChange((value) => {
    const update = adaptDeepSeekState(value);
    if (update) {
      listener(update);
    }
  });
}
