import { PetState } from '../../state/PetStateContext';
import type { PetAnimation } from '../types';

export const idleAnimation: PetAnimation = {
  state: PetState.IDLE,
  className: 'animation-idle',
  label: '空闲',
};
