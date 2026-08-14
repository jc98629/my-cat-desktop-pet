import { createContext, type PropsWithChildren, useContext, useMemo, useState } from 'react';

export enum PetState {
  IDLE = 'IDLE',
  WORKING = 'WORKING',
  WAITING = 'WAITING',
  DONE = 'DONE',
  ERROR = 'ERROR',
}

type PetStateContextValue = {
  state: PetState;
  setState: (state: PetState) => void;
};

const PetStateContext = createContext<PetStateContextValue | null>(null);

export function PetStateProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState(PetState.IDLE);
  const value = useMemo(() => ({ state, setState }), [state]);

  return <PetStateContext.Provider value={value}>{children}</PetStateContext.Provider>;
}

export function usePetState() {
  const context = useContext(PetStateContext);
  if (!context) {
    throw new Error('usePetState must be used inside PetStateProvider');
  }

  return context;
}
