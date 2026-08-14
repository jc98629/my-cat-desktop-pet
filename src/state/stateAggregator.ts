import { PetState } from './PetStateContext';

export type PetStateSource = 'codex' | 'deepseek';
export type AggregatedPetStateSource = PetStateSource | 'both';

export type PetSourceStates = Record<PetStateSource, PetState>;

export type AggregatedPetState = {
  state: PetState;
  source: AggregatedPetStateSource;
  sourceStates: PetSourceStates;
};

const STATE_PRIORITY: PetState[] = [
  PetState.ERROR,
  PetState.WAITING,
  PetState.DONE,
  PetState.WORKING,
  PetState.IDLE,
];

const DEFAULT_SOURCE_STATES: PetSourceStates = {
  codex: PetState.IDLE,
  deepseek: PetState.IDLE,
};

export function aggregatePetStates(sourceStates: PetSourceStates): AggregatedPetState {
  const state =
    STATE_PRIORITY.find(
      (candidate) =>
        sourceStates.codex === candidate || sourceStates.deepseek === candidate,
    ) ?? PetState.IDLE;
  const matchingSources = (['codex', 'deepseek'] as const).filter(
    (source) => sourceStates[source] === state,
  );

  return {
    state,
    source: matchingSources.length === 2 ? 'both' : matchingSources[0],
    sourceStates: { ...sourceStates },
  };
}

export function createPetStateAggregator(initialStates: Partial<PetSourceStates> = {}) {
  let sourceStates: PetSourceStates = {
    ...DEFAULT_SOURCE_STATES,
    ...initialStates,
  };

  return {
    update(source: PetStateSource, state: PetState) {
      sourceStates = { ...sourceStates, [source]: state };
      return aggregatePetStates(sourceStates);
    },
    snapshot() {
      return aggregatePetStates(sourceStates);
    },
  };
}
