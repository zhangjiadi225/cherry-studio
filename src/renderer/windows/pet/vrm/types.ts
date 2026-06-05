import type {
  PetVrmStageAnimationPreset,
  PetVrmStageExpressionName,
  PetVrmStageModelProfile,
  PetVrmStageSceneSettings
} from '@shared/pet'

export type PetVrmModelSummary = {
  id: string
  importedAt: number
  lastModified: number
  name: string
  size: number
  type: string
  updatedAt: number
}

export type PetVrmModelRecord = PetVrmModelSummary & {
  sourceUrl: string
}

export type { PetVrmStageModelProfile }

export type PetVrmStageModelProfileMap = Map<string, PetVrmStageModelProfile>

export type PetVrmStageModel = {
  enabled: boolean
  id: string
  modelId: string
  order: number
  positionX: number
  positionY: number
  positionZ: number
  profile: PetVrmStageModelProfile
}

export type PetVrmStageLookAtPoint = {
  x: number
  y: number
}

export type PetVrmStageModelLoadState = {
  error?: string
  modelId: string
  phase: 'loading' | 'ready' | 'error'
}

export type PetVrmPresentationMotionPhase =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'tool-running'
  | 'waiting-permission'
  | 'done-pulse'
  | 'failed-pulse'

export type PetVrmPresentationMotionState = {
  animationPreset?: PetVrmStageAnimationPreset
  animationTimeScale?: number
  expression?: PetVrmStageExpressionName
  expressionIntensity?: number
  expiresAt?: number
  lookAtCursor?: boolean
  modelId: string
  phase: PetVrmPresentationMotionPhase
  startedAt: number
  taskKey?: string
  updatedAt: number
}

export type { PetVrmStageSceneSettings }
