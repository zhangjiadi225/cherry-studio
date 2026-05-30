import type { PetVrmStageModelProfile, PetVrmStageSceneSettings } from '@shared/pet'

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
  homeXRatio: number
  id: string
  modelId: string
  order: number
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

export type { PetVrmStageSceneSettings }
