import { PetState } from '../../state/PetStateContext';
import type { PetAnimation } from '../types';

export const errorAnimation: PetAnimation = {
  state: PetState.ERROR,
  className: 'animation-error',
  label: '出错',
};
