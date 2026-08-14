import type { PetState } from '../state/PetStateContext';

export type PetAnimation = {
  state: PetState;
  className: string;
  label: string;
};
