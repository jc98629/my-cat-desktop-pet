/// <reference types="vite/client" />

type Point = { x: number; y: number };

interface PetWindowApi {
  setClickThrough(ignore: boolean): void;
  getPosition(): Promise<Point>;
  setPosition(point: Point): void;
  reportState(state: string): void;
  focusCodex(): Promise<boolean>;
  focusDeepSeek(): Promise<boolean>;
}

interface CodexStateApi {
  onChange(listener: (snapshot: unknown) => void): () => void;
}

interface DeepSeekStateApi {
  onChange(listener: (snapshot: unknown) => void): () => void;
}

declare global {
  interface Window {
    petWindow: PetWindowApi;
    codexState: CodexStateApi;
    deepseekState: DeepSeekStateApi;
  }
}

export {};
