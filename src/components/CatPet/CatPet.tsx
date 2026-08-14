import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { petAnimations } from '../../animations';
import {
  PetStatusBubble,
  type PetStatusBubbleSource,
  type PetStatusBubbleState,
} from '../PetStatusBubble/PetStatusBubble';
import type { PetState } from '../../state/PetStateContext';
import { PetState as PetStateValue } from '../../state/PetStateContext';
import { fallbackCatImage, getCatImageForState } from '../../utils/catImageMap';
import { isPointInsideRect } from '../../utils/geometry';
import './CatPet.css';

type CatPetProps = {
  state: PetState;
  imageSrc?: string;
  statusBubble?: PetStatusBubbleState | null;
};

type DragSession = {
  pointerId: number;
  pointerStart: { x: number; y: number };
  windowStart: { x: number; y: number };
  moved: boolean;
};

type HeadPointerSession = {
  pointerId: number;
  pointerStart: { x: number; y: number };
  moved: boolean;
};

const IMAGE_TRANSITION_MS = 200;
const HEAD_DWELL_MS = 450;
const HEAD_NUZZLE_MS = 700;
const WAITING_FIRST_REMINDER_MS = 15_000;
const WAITING_REPEAT_REMINDER_MS = 25_000;

type IdleAction = 'tilt-left' | 'tilt-right' | 'hop' | 'sway';

const IDLE_ACTIONS: IdleAction[] = ['tilt-left', 'tilt-right', 'hop', 'sway'];

function isPointInsideExpandedRect(x: number, y: number, rect: DOMRect, margin: number) {
  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  );
}

export function CatPet({ state, imageSrc, statusBubble = null }: CatPetProps) {
  const petRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const dragSession = useRef<DragSession | null>(null);
  const headPointerSession = useRef<HeadPointerSession | null>(null);
  const clickThrough = useRef(true);
  const transitionTimer = useRef<number | undefined>(undefined);
  const headDwellTimer = useRef<number | undefined>(undefined);
  const headNuzzleTimer = useRef<number | undefined>(undefined);
  const idleActionFrame = useRef<number | undefined>(undefined);
  const [isPressed, setIsPressed] = useState(false);
  const [isNuzzling, setIsNuzzling] = useState(false);
  const [idleAction, setIdleAction] = useState<IdleAction | null>(null);
  const [waitingReminderActive, setWaitingReminderActive] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [usesMaterialSheet, setUsesMaterialSheet] = useState(false);
  const animation = petAnimations[state];
  const requestedImageSrc = imageSrc ?? getCatImageForState(state);
  const resolvedImageSrc = failedImageSrc === requestedImageSrc ? fallbackCatImage : requestedImageSrc;
  const activeImageRef = useRef(resolvedImageSrc);
  const [activeImageSrc, setActiveImageSrc] = useState(resolvedImageSrc);
  const [outgoingImageSrc, setOutgoingImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const previousImageSrc = activeImageRef.current;
    if (previousImageSrc === resolvedImageSrc) {
      return;
    }

    window.clearTimeout(transitionTimer.current);
    setOutgoingImageSrc(previousImageSrc);
    setActiveImageSrc(resolvedImageSrc);
    activeImageRef.current = resolvedImageSrc;
    transitionTimer.current = window.setTimeout(
      () => setOutgoingImageSrc(null),
      IMAGE_TRANSITION_MS + 20,
    );

    return () => window.clearTimeout(transitionTimer.current);
  }, [resolvedImageSrc]);

  const setClickThrough = (ignore: boolean) => {
    if (clickThrough.current === ignore) {
      return;
    }

    clickThrough.current = ignore;
    window.petWindow.setClickThrough(ignore);
  };

  const resetIdleMotion = () => {
    const pet = petRef.current;
    if (!pet) {
      return;
    }

    pet.style.setProperty('--idle-follow-x', '0px');
    pet.style.setProperty('--idle-follow-rotate', '0deg');
    pet.style.setProperty('--idle-nuzzle-x', '0px');
    pet.style.setProperty('--idle-nuzzle-rotate', '0deg');
  };

  const updateIdleFollow = (clientX: number, clientY: number, rect: DOMRect) => {
    const pet = petRef.current;
    if (!pet || state !== PetStateValue.IDLE || !isPointInsideExpandedRect(clientX, clientY, rect, 24)) {
      resetIdleMotion();
      return;
    }

    const direction = Math.max(-1, Math.min(1, (clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
    pet.style.setProperty('--idle-follow-x', `${(direction * 2.4).toFixed(2)}px`);
    pet.style.setProperty('--idle-follow-rotate', `${(direction * 0.9).toFixed(2)}deg`);
  };

  const updateClickThroughForPoint = (clientX: number, clientY: number) => {
    if (dragSession.current) {
      setClickThrough(false);
      return;
    }

    const petRect = petRef.current?.getBoundingClientRect();
    const bubbleRect = bubbleRef.current?.getBoundingClientRect();
    const overPet = Boolean(petRect && isPointInsideRect(clientX, clientY, petRect));
    const overBubble = Boolean(bubbleRect && isPointInsideRect(clientX, clientY, bubbleRect));
    setClickThrough(!overPet && !overBubble);

    if (petRect) {
      updateIdleFollow(clientX, clientY, petRect);
    }
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      updateClickThroughForPoint(event.clientX, event.clientY);
    };

    const handleMouseLeave = () => {
      if (!dragSession.current) {
        setClickThrough(true);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
      window.petWindow.setClickThrough(true);
    };
  }, [state, statusBubble]);

  useEffect(() => {
    window.clearTimeout(headDwellTimer.current);
    window.clearTimeout(headNuzzleTimer.current);
    window.cancelAnimationFrame(idleActionFrame.current ?? 0);
    headPointerSession.current = null;

    if (state !== PetStateValue.IDLE) {
      setIsNuzzling(false);
      setIdleAction(null);
      resetIdleMotion();
    }

    if (state !== PetStateValue.WAITING) {
      setWaitingReminderActive(false);
    }
  }, [state]);

  useEffect(() => {
    if (state !== PetStateValue.WAITING) {
      return;
    }

    let repeatTimer: number | undefined;
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;

    const triggerReminder = () => {
      setWaitingReminderActive(false);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setWaitingReminderActive(true));
      });
    };

    const firstTimer = window.setTimeout(() => {
      triggerReminder();
      repeatTimer = window.setInterval(triggerReminder, WAITING_REPEAT_REMINDER_MS);
    }, WAITING_FIRST_REMINDER_MS);

    return () => {
      window.clearTimeout(firstTimer);
      window.clearInterval(repeatTimer);
      window.cancelAnimationFrame(firstFrame ?? 0);
      window.cancelAnimationFrame(secondFrame ?? 0);
    };
  }, [state]);

  const updateNuzzleDirection = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (state !== PetStateValue.IDLE) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const direction = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
    petRef.current?.style.setProperty('--idle-nuzzle-x', `${(direction * 3.6).toFixed(2)}px`);
    petRef.current?.style.setProperty('--idle-nuzzle-rotate', `${direction.toFixed(2)}deg`);
  };

  const handleHeadPointerEnter = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (state !== PetStateValue.IDLE) {
      return;
    }

    updateNuzzleDirection(event);
    window.clearTimeout(headDwellTimer.current);
    window.clearTimeout(headNuzzleTimer.current);
    setIsNuzzling(false);
    headDwellTimer.current = window.setTimeout(() => {
      setIsNuzzling(true);
      headNuzzleTimer.current = window.setTimeout(
        () => setIsNuzzling(false),
        HEAD_NUZZLE_MS,
      );
    }, HEAD_DWELL_MS);
  };

  const handleHeadPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    updateNuzzleDirection(event);

    const session = headPointerSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.hypot(
        event.clientX - session.pointerStart.x,
        event.clientY - session.pointerStart.y,
      ) > 4
    ) {
      session.moved = true;
    }
  };

  const handleHeadPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setClickThrough(false);
    headPointerSession.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  };

  const finishHeadPointerInteraction = (
    event: ReactPointerEvent<HTMLSpanElement>,
    triggerAction: boolean,
  ) => {
    event.stopPropagation();

    const session = headPointerSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    headPointerSession.current = null;
    if (triggerAction && !session.moved) {
      triggerIdleAction();
    }
  };

  const handleHeadPointerLeave = () => {
    window.clearTimeout(headDwellTimer.current);
    window.clearTimeout(headNuzzleTimer.current);
    setIsNuzzling(false);
    petRef.current?.style.setProperty('--idle-nuzzle-x', '0px');
    petRef.current?.style.setProperty('--idle-nuzzle-rotate', '0deg');
  };

  const triggerIdleAction = () => {
    if (state !== PetStateValue.IDLE) {
      return;
    }

    const nextAction = IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)];
    setIsNuzzling(false);
    setIdleAction(null);
    window.cancelAnimationFrame(idleActionFrame.current ?? 0);
    idleActionFrame.current = window.requestAnimationFrame(() => setIdleAction(nextAction));
  };

  const handlePointerDown = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setClickThrough(false);
    setIsPressed(true);

    const windowStart = await window.petWindow.getPosition();
    dragSession.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.screenX, y: event.screenY },
      windowStart,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - session.pointerStart.x;
    const deltaY = event.screenY - session.pointerStart.y;
    if (Math.hypot(deltaX, deltaY) > 4) {
      session.moved = true;
    }

    window.petWindow.setPosition({
      x: session.windowStart.x + deltaX,
      y: session.windowStart.y + deltaY,
    });
  };

  const finishPointerInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragSession.current = null;
    setIsPressed(false);

    if (!session.moved) {
      triggerIdleAction();
    }
  };

  const requestSourceFocus = (source: Exclude<PetStatusBubbleSource, 'both'>) => {
    if (source === 'codex') {
      void window.petWindow.focusCodex();
      return;
    }

    void window.petWindow.focusDeepSeek();
  };

  return (
    <div
      ref={petRef}
      className={`cat-pet ${animation.className} ${isPressed ? 'is-pressed' : ''} ${statusBubble ? 'has-status-bubble' : ''}`}
      data-state={state}
      role="button"
      aria-label={`小猫桌宠，当前状态：${animation.label}`}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={finishPointerInteraction}
      onPointerEnter={() => setClickThrough(false)}
      onPointerLeave={(event) => updateClickThroughForPoint(event.clientX, event.clientY)}
    >
      {statusBubble && (
        <span
          ref={bubbleRef}
          className="cat-pet__bubble-anchor"
          onPointerEnter={() => setClickThrough(false)}
          onPointerLeave={(event) => updateClickThroughForPoint(event.clientX, event.clientY)}
        >
          <PetStatusBubble
            kind={statusBubble.kind}
            source={statusBubble.source}
            onRequestSourceFocus={requestSourceFocus}
          />
        </span>
      )}
      <span
        className={`cat-pet__motion-layer ${isNuzzling ? 'is-nuzzling' : ''}`}
      >
        <span
          className={`cat-pet__action-layer ${idleAction ? `idle-action--${idleAction}` : ''} ${waitingReminderActive ? 'is-waiting-reminder' : ''}`}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }
            setIdleAction(null);
            setWaitingReminderActive(false);
          }}
        >
          <span
            className={`cat-pet__image-frame ${usesMaterialSheet ? 'cat-pet__image-frame--material-sheet' : ''}`}
          >
            {outgoingImageSrc && (
              <img
                key={`outgoing-${outgoingImageSrc}`}
                className="cat-pet__image cat-pet__image--outgoing"
                src={outgoingImageSrc}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            )}
          <img
            key={`active-${activeImageSrc}`}
            className="cat-pet__image cat-pet__image--active"
            src={activeImageSrc}
            alt="布偶猫桌宠"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setUsesMaterialSheet(image.naturalWidth === 1536 && image.naturalHeight === 1024);
            }}
            onError={() => {
              if (activeImageSrc !== fallbackCatImage) {
                setFailedImageSrc(activeImageSrc);
                setUsesMaterialSheet(false);
              }
            }}
          />
          </span>
        </span>
      </span>
      {state === PetStateValue.IDLE && (
        <span
          className="cat-pet__head-hitbox"
          aria-hidden="true"
          onPointerEnter={handleHeadPointerEnter}
          onPointerMove={handleHeadPointerMove}
          onPointerDown={handleHeadPointerDown}
          onPointerUp={(event) => finishHeadPointerInteraction(event, true)}
          onPointerCancel={(event) => finishHeadPointerInteraction(event, false)}
          onPointerLeave={handleHeadPointerLeave}
        />
      )}
      <span className="cat-pet__shadow" aria-hidden="true" />
    </div>
  );
}
