import './PetStatusBubble.css';

export type PetStatusBubbleKind = 'WAITING' | 'DONE';
export type PetStatusBubbleSource = 'codex' | 'deepseek' | 'both';
export type PetStatusBubbleState = {
  kind: PetStatusBubbleKind;
  source: PetStatusBubbleSource;
};

type PetStatusBubbleProps = {
  kind: PetStatusBubbleKind;
  source: PetStatusBubbleSource;
  onRequestSourceFocus: (source: Exclude<PetStatusBubbleSource, 'both'>) => void;
};

const SOURCE_LABEL: Record<PetStatusBubbleSource, string> = {
  codex: 'Codex',
  deepseek: 'DeepSeek',
  both: 'Codex、DeepSeek',
};

function BubbleContent({ kind, source }: Pick<PetStatusBubbleProps, 'kind' | 'source'>) {
  const waiting = kind === 'WAITING';
  const both = source === 'both';

  return (
    <>
      <span className="pet-status-bubble__indicator" aria-hidden="true">
        {waiting ? '!' : '✓'}
      </span>
      <span className="pet-status-bubble__copy">
        <strong>{SOURCE_LABEL[source]}</strong>
        <span>{both ? (waiting ? '都在等你' : '任务均已完成') : waiting ? '需要你的确认' : '任务完成'}</span>
      </span>
      {waiting && !both && <span className="pet-status-bubble__action">去处理 →</span>}
    </>
  );
}

export function PetStatusBubble({ kind, source, onRequestSourceFocus }: PetStatusBubbleProps) {
  if (kind === 'WAITING' && source !== 'both') {
    return (
      <button
        className="pet-status-bubble pet-status-bubble--waiting"
        type="button"
        aria-label={`${SOURCE_LABEL[source]} 需要你的确认，点击去处理`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onRequestSourceFocus(source)}
      >
        <BubbleContent kind={kind} source={source} />
      </button>
    );
  }

  return (
    <div
      className={`pet-status-bubble pet-status-bubble--${kind === 'WAITING' ? 'waiting' : 'done'}`}
      role="status"
      aria-live="polite"
    >
      <BubbleContent kind={kind} source={source} />
    </div>
  );
}
