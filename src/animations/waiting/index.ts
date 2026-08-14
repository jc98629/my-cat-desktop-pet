import { PetState } from '../../state/PetStateContext';
import type { PetAnimation } from '../types';

export const waitingAnimation: PetAnimation = {
  state: PetState.WAITING,
  className: 'animation-waiting',
  label: '等待中',
};
