import fallbackCatImage from '../assets/default-cat-placeholder.svg';
import { PetState } from '../state/PetStateContext';

export const catImageFileByState: Record<PetState, string> = {
  [PetState.IDLE]: 'idle.png',
  [PetState.WORKING]: 'working.png',
  [PetState.WAITING]: 'waiting.png',
  [PetState.DONE]: 'done.png',
  [PetState.ERROR]: 'error.png',
};

const catImageModules = import.meta.glob<string>('../assets/cat/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function getCatImageForState(state: PetState) {
  const fileName = catImageFileByState[state];
  return catImageModules[`../assets/cat/${fileName}`] ?? fallbackCatImage;
}

export { fallbackCatImage };
