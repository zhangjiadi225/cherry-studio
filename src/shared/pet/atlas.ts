export const PET_ATLAS_COLUMNS = 8
export const PET_ATLAS_ROWS = 9
export const PET_FRAME_WIDTH = 192
export const PET_FRAME_HEIGHT = 208
export const PET_SPRITESHEET_WIDTH = PET_ATLAS_COLUMNS * PET_FRAME_WIDTH
export const PET_SPRITESHEET_HEIGHT = PET_ATLAS_ROWS * PET_FRAME_HEIGHT
export const PET_DEFAULT_SCALE = 0.42
export const PET_MIN_SCALE = 0.24
export const PET_MAX_SCALE = 0.64
export const PET_ANIMAL_WIDTH = Math.round(PET_FRAME_WIDTH * PET_DEFAULT_SCALE)
export const PET_ANIMAL_HEIGHT = Math.round(PET_FRAME_HEIGHT * PET_DEFAULT_SCALE)
export const PET_PASTURE_MIN_WIDTH = 360
export const PET_PASTURE_DEFAULT_WIDTH = 640
export const PET_PASTURE_MAX_WIDTH = 2560
export const PET_PASTURE_HEIGHT = 200
export const PET_PASTURE_GROUND_BOTTOM_OFFSET = 0
export const PET_GROUND_HIT_HEIGHT = 48
export const PET_REPLY_MAX_HEIGHT = 172
export const PET_WINDOW_WIDTH = PET_PASTURE_DEFAULT_WIDTH
export const PET_WINDOW_HEIGHT = 320
export const PET_VRM_STAGE_DEFAULT_WIDTH = 450
export const PET_VRM_STAGE_DEFAULT_HEIGHT = 600
export const PET_VRM_STAGE_MIN_WIDTH = 100
export const PET_VRM_STAGE_MIN_HEIGHT = 200

export type PetDimensions = {
  height: number
  width: number
}

export const PET_ANIMATION_NAMES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review'
] as const

export type PetAnimationName = (typeof PET_ANIMATION_NAMES)[number]

export const PET_SEMANTIC_ANIMATION_NAMES = [
  'idle',
  'walkLeft',
  'walkRight',
  'run',
  'wave',
  'jump',
  'sleep',
  'observe',
  'play',
  'celebrate',
  'waiting',
  'review',
  'failed'
] as const

export type PetSemanticAnimationName = (typeof PET_SEMANTIC_ANIMATION_NAMES)[number]

export type PetAnimationDefinition = {
  row: number
  frameCount: number
  frameDurations: number[]
  loop: boolean
}

// Codex atlas definitions describe the legacy single-spritesheet format.
// Future rich packages should resolve their assets to PetRuntimeClip objects
// before rendering, leaving these constants as the compatibility fallback.

export const PET_ANIMATIONS: Record<PetAnimationName, PetAnimationDefinition> = {
  idle: { row: 0, frameCount: 6, frameDurations: [280, 110, 110, 140, 140, 320], loop: true },
  'running-right': { row: 1, frameCount: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  'running-left': { row: 2, frameCount: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  waving: { row: 3, frameCount: 4, frameDurations: [140, 140, 140, 280], loop: false },
  jumping: { row: 4, frameCount: 5, frameDurations: [140, 140, 140, 140, 280], loop: false },
  failed: { row: 5, frameCount: 8, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240], loop: true },
  waiting: { row: 6, frameCount: 6, frameDurations: [150, 150, 150, 150, 150, 260], loop: true },
  running: { row: 7, frameCount: 6, frameDurations: [120, 120, 120, 120, 120, 220], loop: true },
  review: { row: 8, frameCount: 6, frameDurations: [150, 150, 150, 150, 150, 280], loop: true }
}

export type PetAtlasFrame = {
  x: number
  y: number
  width: number
  height: number
}

export function getPetAtlasFrame(animation: PetAnimationName, frameIndex: number): PetAtlasFrame {
  const definition = PET_ANIMATIONS[animation]
  const normalizedFrame = ((frameIndex % definition.frameCount) + definition.frameCount) % definition.frameCount

  return {
    x: normalizedFrame * PET_FRAME_WIDTH,
    y: definition.row * PET_FRAME_HEIGHT,
    width: PET_FRAME_WIDTH,
    height: PET_FRAME_HEIGHT
  }
}

export function isPetAnimationName(value: unknown): value is PetAnimationName {
  return typeof value === 'string' && PET_ANIMATION_NAMES.includes(value as PetAnimationName)
}

export function getPetAnimationDuration(animation: PetAnimationName): number {
  return PET_ANIMATIONS[animation].frameDurations.reduce((total, duration) => total + duration, 0)
}

export function clampPetScale(scale: number): number {
  if (!Number.isFinite(scale)) return PET_DEFAULT_SCALE
  return Math.min(Math.max(scale, PET_MIN_SCALE), PET_MAX_SCALE)
}

export function getPetDimensions(scale: number): PetDimensions {
  const boundedScale = clampPetScale(scale)
  return {
    height: Math.round(PET_FRAME_HEIGHT * boundedScale),
    width: Math.round(PET_FRAME_WIDTH * boundedScale)
  }
}

export function isPetSemanticAnimationName(value: unknown): value is PetSemanticAnimationName {
  return typeof value === 'string' && PET_SEMANTIC_ANIMATION_NAMES.includes(value as PetSemanticAnimationName)
}

export function getPetPackageAnimation(
  petPackage: { animations?: Partial<Record<PetSemanticAnimationName, PetAnimationDefinition>> },
  animation: PetSemanticAnimationName
): PetAnimationDefinition {
  return petPackage.animations?.[animation] ?? PET_ANIMATIONS[getLegacyAnimationName(animation)]
}

export function getPetPackageSpritesheetHeight(petPackage: {
  animations?: Partial<Record<PetSemanticAnimationName, PetAnimationDefinition>>
}): number {
  const maxOverrideRow = Math.max(-1, ...Object.values(petPackage.animations ?? {}).map((animation) => animation.row))
  return Math.max(PET_SPRITESHEET_HEIGHT, (maxOverrideRow + 1) * PET_FRAME_HEIGHT)
}

export function getLegacyAnimationName(animation: PetSemanticAnimationName): PetAnimationName {
  switch (animation) {
    case 'walkLeft':
      return 'running-left'
    case 'walkRight':
      return 'running-right'
    case 'run':
      return 'running'
    case 'wave':
      return 'waving'
    case 'jump':
    case 'play':
    case 'celebrate':
      return 'jumping'
    case 'waiting':
      return 'waiting'
    case 'review':
      return 'review'
    case 'failed':
      return 'failed'
    case 'idle':
    case 'sleep':
    case 'observe':
      return 'idle'
  }
}
