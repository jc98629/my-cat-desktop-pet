import { PetState } from '../../state/PetStateContext';
import type { PetAnimation } from '../types';

export const doneAnimation: PetAnimation = {
  state: PetState.DONE,
  className: 'animation-done',
  label: '已完成',
};
