import { PetState } from '../state/PetStateContext';
import { doneAnimation } from './done';
import { errorAnimation } from './error';
import { idleAnimation } from './idle';
import type { PetAnimation } from './types';
import { waitingAnimation } from './waiting';
import { workingAnimation } from './working';

export const petAnimations: Record<PetState, PetAnimation> = {
  [PetState.IDLE]: idleAnimation,
  [PetState.WORKING]: workingAnimation,
  [PetState.WAITING]: waitingAnimation,
  [PetState.DONE]: doneAnimation,
  [PetState.ERROR]: errorAnimation,
};
