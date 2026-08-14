import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToCodexPetState } from './adapters/codex';
import { subscribeToDeepSeekPetState } from './adapters/deepseek';
import { CatPet } from './components/CatPet/CatPet';
import type {
  PetStatusBubbleSource,
  PetStatusBubbleState,
} from './components/PetStatusBubble/PetStatusBubble';
import { PetState, usePetState } from './state/PetStateContext';
import {
  createPetStateAggregator,
  type AggregatedPetState,
  type PetStateSource,
} from './state/stateAggregator';

const DONE_BUBBLE_HOLD_MS = 6_000;

export function App() {
  const { state, setState } = usePetState();
  const stateAggregator = useRef(createPetStateAggregator()).current;
  const sourceResetTimers = useRef<Partial<Record<PetStateSource, number>>>({});
  const bubbleTimer = useRef<number | undefined>(undefined);
  const [statusBubble, setStatusBubble] = useState<PetStatusBubbleState | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(sourceResetTimers.current.codex);
      window.clearTimeout(sourceResetTimers.current.deepseek);
      window.clearTimeout(bubbleTimer.current);
    },
    [],
  );

  const updateStatusBubble = useCallback((nextState: PetState, source: PetStatusBubbleSource) => {
    window.clearTimeout(bubbleTimer.current);

    if (nextState === PetState.WAITING) {
      setStatusBubble({ kind: 'WAITING', source });
      return;
    }

    if (nextState === PetState.DONE) {
      setStatusBubble({ kind: 'DONE', source });
      bubbleTimer.current = window.setTimeout(
        () => setStatusBubble(null),
        DONE_BUBBLE_HOLD_MS,
      );
      return;
    }

    setStatusBubble(null);
  }, []);

  const applyAggregatedState = useCallback(
    (aggregated: AggregatedPetState) => {
      updateStatusBubble(aggregated.state, aggregated.source);
      setState(aggregated.state);
    },
    [setState, updateStatusBubble],
  );

  const applySourceState = useCallback(
    (source: PetStateSource, nextState: PetState, doneHoldMs: number) => {
      window.clearTimeout(sourceResetTimers.current[source]);
      delete sourceResetTimers.current[source];
      applyAggregatedState(stateAggregator.update(source, nextState));

      if (nextState === PetState.DONE && doneHoldMs > 0) {
        sourceResetTimers.current[source] = window.setTimeout(() => {
          delete sourceResetTimers.current[source];
          applyAggregatedState(stateAggregator.update(source, PetState.IDLE));
        }, doneHoldMs);
      }
    },
    [applyAggregatedState, stateAggregator],
  );

  useEffect(() => {
    window.petWindow.reportState(state);
  }, [state]);

  useEffect(() => {
    const unsubscribeCodex = subscribeToCodexPetState(({ state: nextState, doneHoldMs }) => {
      applySourceState('codex', nextState, doneHoldMs);
    });
    const unsubscribeDeepSeek = subscribeToDeepSeekPetState(
      ({ state: nextState, doneHoldMs }) => {
        applySourceState('deepseek', nextState, doneHoldMs);
      },
    );

    return () => {
      unsubscribeCodex();
      unsubscribeDeepSeek();
    };
  }, [applySourceState]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const testStateByKey: Partial<Record<string, PetState>> = {
      '1': PetState.IDLE,
      '2': PetState.WORKING,
      '3': PetState.WAITING,
      '4': PetState.DONE,
      '5': PetState.ERROR,
    };

    const handleTestShortcut = (event: KeyboardEvent) => {
      const nextState = testStateByKey[event.key];
      if (!nextState) {
        return;
      }

      window.clearTimeout(sourceResetTimers.current.codex);
      window.clearTimeout(sourceResetTimers.current.deepseek);
      delete sourceResetTimers.current.codex;
      delete sourceResetTimers.current.deepseek;
      const sourceStates = stateAggregator.snapshot().sourceStates;
      if (sourceStates.codex === PetState.DONE) {
        stateAggregator.update('codex', PetState.IDLE);
      }
      if (sourceStates.deepseek === PetState.DONE) {
        stateAggregator.update('deepseek', PetState.IDLE);
      }
      updateStatusBubble(nextState, 'codex');
      setState(nextState);
    };

    window.addEventListener('keydown', handleTestShortcut);
    return () => window.removeEventListener('keydown', handleTestShortcut);
  }, [setState, stateAggregator, updateStatusBubble]);

  return (
    <main className="pet-stage">
      <CatPet state={state} statusBubble={statusBubble} />
    </main>
  );
}
