import { PetState } from '../../state/PetStateContext';
import type { PetAnimation } from '../types';

export const workingAnimation: PetAnimation = {
  state: PetState.WORKING,
  className: 'animation-working',
  label: '工作中',
};
