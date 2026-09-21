/** The public interface used by our adapter; implementation is preserved upstream code. */
export interface AstraConfig {
  convergeDuration: number;
  [key: string]: unknown;
}

export interface AstraFrameInput {
  reducedMotion: boolean;
  progress: number;
  tiltProgress: number | null;
  scatterProgress: number | null;
  heroViewportHeight: number | null;
}

export interface AstraAnimationState {
  introElapsed: number;
  introProgress: number;
  dispose(): void;
}

export interface AstraRenderer {
  ready: Promise<unknown>;
  camera: unknown;
  animationRoot: unknown;
  spinRoot: unknown;
  field: unknown;
  resize(width: number, height: number, dpr: number): void;
  render(delta: number, animation: AstraAnimationState, config: AstraConfig, reducedMotion: boolean): void;
  dispose(): void;
}

export interface AstraProfile {
  tier: number;
  canUseWebGL(): boolean;
  getPostprocessing(): string;
  getAntialias(): boolean;
  getDpr(): [number, number];
  getMaxParticleCount(): number;
  getMaxShaderSamples(): number;
  shouldUseContinuousMotion(): boolean;
}

export const DEFAULT_ASTRA_HERO_DATA: AstraConfig;
export function createAstraFrameInput(): AstraFrameInput;
export function createAstraAnimationState(config: AstraConfig): AstraAnimationState;
export function createAstraRenderer(canvas: HTMLCanvasElement, config: AstraConfig, profile: AstraProfile): AstraRenderer;
export function updateAstraAnimation(context: {
  state: AstraAnimationState;
  config: AstraConfig;
  input: AstraFrameInput;
  camera: unknown;
  animationRoot: unknown;
  spinRoot: unknown;
  field: unknown;
  viewport: { width: number; height: number };
}, delta: number, elapsedDelta?: number): boolean;
