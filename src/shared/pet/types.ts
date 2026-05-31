import type { CherryMessagePart, CherryUIMessage } from '../data/types/message'
import type { PetAnimationDefinition, PetSemanticAnimationName } from './atlas'

export type PetPackageFormat = 'codex-atlas' | 'cherry-multi-asset'

export type PetCodexAtlasFallback = {
  format: 'codex-atlas'
  spritesheetPath: string
}

export type PetRuntimeFrame = {
  imageUrl: string
  x?: number
  y?: number
  width: number
  height: number
}

export type PetRuntimeClip = {
  frames: PetRuntimeFrame[]
  frameDurations: number[]
  loop: boolean
  phaseKey?: string
}

export type PetMultiAssetFrame = {
  assetPath: string
  durationMs: number
  width: number
  height: number
}

export type PetMultiAssetClip = {
  frames: PetMultiAssetRuntimeFrame[]
  loop: boolean
  phaseGroup?: string
}

export type PetMultiAssetManifestClip = {
  action: PetSemanticAnimationName
  frames: PetMultiAssetFrame[]
  loop: boolean
  phaseGroup?: string
}

export type PetMultiAssetManifest = {
  schemaVersion: 1
  clips: PetMultiAssetManifestClip[]
}

export type PetMultiAssetRuntimeFrame = {
  imageUrl: string
  durationMs: number
  width: number
  height: number
}

export type PetPackageMetadata = {
  schemaVersion?: number
  format?: PetPackageFormat
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  kind?: string
  animations?: Partial<Record<PetSemanticAnimationName, PetAnimationDefinition>>
  // Reserved for the future rich package format. pet.json remains the single entry point;
  // this path must only be honored when format is explicitly "cherry-multi-asset".
  animationManifestPath?: string
  fallback?: PetCodexAtlasFallback
  multiAssetClips?: Partial<Record<PetSemanticAnimationName, PetMultiAssetClip>>
}

export type PetPackageInfo = PetPackageMetadata & {
  imported: boolean
  spriteUrl: string
}

export const PET_ASSET_KINDS = ['sprite-package', 'vrm-model'] as const

export type PetAssetKind = (typeof PET_ASSET_KINDS)[number]

export type PetAssetFileRole = 'manifest' | 'model' | 'sprite' | 'thumbnail'

export type PetAssetFileInfo = {
  role: PetAssetFileRole
  relativePath: string
  mediaType?: string
  sizeBytes?: number
}

export type PetAssetInfo = {
  id: string
  kind: PetAssetKind
  displayName: string
  createdAt: number
  updatedAt: number
  files: PetAssetFileInfo[]
  originalFileName?: string
  sizeBytes?: number
}

export type PetAssetListRequest = {
  kind?: PetAssetKind
}

export type PetAssetImportRequest = {
  kind: PetAssetKind
  sourcePath: string
  displayName?: string
  originalFileName?: string
  mediaType?: string
}

export type PetAssetImportRemoteRequest = {
  kind: Extract<PetAssetKind, 'vrm-model'>
  sourceUrl: string
  fileName: string
  displayName?: string
  mediaType?: string
}

export type PetAssetDeleteRequest = {
  assetId: string
  kind: PetAssetKind
}

export type PetAssetResolveRequest = {
  assetId: string
  fileRole?: PetAssetFileRole
  kind: PetAssetKind
}

export type PetAssetResolveResult = {
  asset: PetAssetInfo
  url: string
}

export type PetWindowPosition = {
  x: number
  y: number
}

export type PetWindowBounds = PetWindowPosition & {
  width: number
  height: number
}

export type PetVrmWindowBounds = PetWindowBounds

export type PetMouseState = {
  cursor: PetWindowPosition
  bounds: PetWindowBounds
  updatedAt: number
}

export type PetWindowResizeEdge =
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'
  | 'left'
  | 'right'
  | 'top'
  | 'top-left'
  | 'top-right'

export type PetWindowResizeRequest = PetWindowBounds & {
  edge: PetWindowResizeEdge
  mode: PetSceneMode
}

export type PetPastureResizeEdge = Extract<PetWindowResizeEdge, 'left' | 'right'>

export type PetPastureResizeRequest = {
  edge: PetPastureResizeEdge
  x: number
  width: number
}

export type PetActivityState = {
  animation: PetSemanticAnimationName
  playOnce?: boolean
  reason?: string
  updatedAt: number
}

export const PET_PERSONALITIES = ['scout', 'napster', 'greeter', 'performer', 'companion', 'watcher'] as const

export type PetPersonality = (typeof PET_PERSONALITIES)[number]

export const DEFAULT_PET_PERSONALITY: PetPersonality = 'watcher'

export function isPetPersonality(value: unknown): value is PetPersonality {
  return typeof value === 'string' && (PET_PERSONALITIES as readonly string[]).includes(value)
}

export type PetAnimalInstance = {
  agentId?: string | null
  id: string
  packageId: string
  name: string
  order: number
  enabled: boolean
  homeXRatio: number
  personality: PetPersonality
  createdAt: string
}

export type PetPastureBounds = {
  x: number
  y: number
  width: number
}

export const PET_SCENE_MODES = ['sprite-pasture', 'vrm-stage'] as const

export type PetSceneMode = (typeof PET_SCENE_MODES)[number]

export function isPetSceneMode(value: unknown): value is PetSceneMode {
  return typeof value === 'string' && (PET_SCENE_MODES as readonly string[]).includes(value)
}

export type PetSceneProfile = {
  mode: PetSceneMode
  updatedAt: number
}

export const PET_VRM_STAGE_ANIMATION_PRESETS = [
  'vroid-show-full-body',
  'vroid-greeting',
  'vroid-peace-sign',
  'vroid-shoot',
  'vroid-spin',
  'vroid-model-pose',
  'vroid-squat'
] as const

export type PetVrmStageAnimationPreset = (typeof PET_VRM_STAGE_ANIMATION_PRESETS)[number]

export const PET_VRM_STAGE_EXPRESSION_NAMES = ['neutral', 'happy', 'relaxed', 'surprised', 'angry', 'sad'] as const

export type PetVrmStageExpressionName = (typeof PET_VRM_STAGE_EXPRESSION_NAMES)[number]

export type PetVrmStageSceneSettings = {
  ambientLightIntensity: number
  cameraFar: number
  cameraFov: number
  cameraNear: number
  cameraPositionX: number
  cameraPositionY: number
  cameraPositionZ: number
  cameraTargetX: number
  cameraTargetY: number
  cameraTargetZ: number
  fillLightIntensity: number
  lookAtTargetX: number
  lookAtTargetY: number
  lookAtTargetZ: number
  keyLightIntensity: number
}

export const PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS: PetVrmStageSceneSettings = {
  ambientLightIntensity: 2.2,
  cameraFar: 2000,
  cameraFov: 40,
  cameraNear: 0.1,
  cameraPositionX: 0,
  cameraPositionY: 0,
  cameraPositionZ: -1,
  cameraTargetX: 0,
  cameraTargetY: 0,
  cameraTargetZ: 0,
  fillLightIntensity: 1.2,
  lookAtTargetX: 0,
  lookAtTargetY: 0,
  lookAtTargetZ: -100,
  keyLightIntensity: 2.8
}

export type PetVrmStageModelProfile = {
  animationPreset?: PetVrmStageAnimationPreset
  blink?: boolean
  createdAt: number
  enabled: boolean
  expression?: PetVrmStageExpressionName
  expressionIntensity?: number
  idleMotion?: boolean
  lookAtCursor?: boolean
  modelId: string
  order: number
  positionX: number
  positionY: number
  positionZ: number
  updatedAt: number
}

export type PetVrmStageModelProfileRecord = Record<string, PetVrmStageModelProfile>

export type PetVrmStageConfig = {
  modelProfiles: PetVrmStageModelProfileRecord
  sceneSettings: PetVrmStageSceneSettings
}

export function createPetVrmStageModelProfile(
  input: Partial<PetVrmStageModelProfile> = {},
  previous?: PetVrmStageModelProfile
): PetVrmStageModelProfile {
  const now = Date.now()
  const modelId = normalizePetOptionalString('modelId' in input ? input.modelId : previous?.modelId)
  if (!modelId) throw new Error('VRM model id is required')

  return {
    createdAt: Number.isFinite(input.createdAt) ? Number(input.createdAt) : (previous?.createdAt ?? now),
    animationPreset: normalizePetVrmStageAnimationPreset(input.animationPreset ?? previous?.animationPreset),
    blink: typeof input.blink === 'boolean' ? input.blink : (previous?.blink ?? true),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : (previous?.enabled ?? false),
    expression: normalizePetVrmStageExpressionName(input.expression ?? previous?.expression),
    expressionIntensity: normalizePetOptionalClampedNumber(
      input.expressionIntensity ?? previous?.expressionIntensity,
      0,
      1
    ),
    idleMotion: typeof input.idleMotion === 'boolean' ? input.idleMotion : (previous?.idleMotion ?? true),
    lookAtCursor: typeof input.lookAtCursor === 'boolean' ? input.lookAtCursor : (previous?.lookAtCursor ?? true),
    modelId,
    order: Number.isFinite(input.order) ? Number(input.order) : (previous?.order ?? 0),
    positionX: normalizePetVrmStageCoordinate(input.positionX ?? previous?.positionX, 0),
    positionY: normalizePetVrmStageCoordinate(input.positionY ?? previous?.positionY, 0),
    positionZ: normalizePetVrmStageCoordinate(
      input.positionZ ?? previous?.positionZ,
      getDefaultPetVrmStageModelPositionZ(input.order ?? previous?.order ?? 0)
    ),
    updatedAt: Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : now
  }
}

export function normalizePetVrmStageModelProfile(
  key: string,
  profile: Partial<PetVrmStageModelProfile> | undefined | null
): PetVrmStageModelProfile | null {
  if (!profile || typeof profile !== 'object') return null
  const modelId = normalizePetOptionalString(profile.modelId) ?? normalizePetOptionalString(key)
  if (!modelId) return null
  return createPetVrmStageModelProfile({ ...profile, modelId })
}

export function normalizePetVrmStageModelProfileRecord(input: unknown): PetVrmStageModelProfileRecord {
  const record: PetVrmStageModelProfileRecord = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return record

  for (const [key, profile] of Object.entries(input as Record<string, Partial<PetVrmStageModelProfile>>)) {
    const normalized = normalizePetVrmStageModelProfile(key, profile)
    if (normalized && !record[normalized.modelId]) {
      record[normalized.modelId] = normalized
    }
  }

  return record
}

export function normalizePetVrmStageSceneSettings(input: unknown): PetVrmStageSceneSettings {
  const record = input && typeof input === 'object' ? (input as Partial<PetVrmStageSceneSettings>) : {}
  const cameraNear = normalizePetClampedNumber(
    record.cameraNear,
    0.01,
    10,
    PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraNear
  )
  const cameraFar = Math.max(
    normalizePetClampedNumber(record.cameraFar, 10, 5000, PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraFar),
    cameraNear + 1
  )

  return {
    ambientLightIntensity: normalizePetClampedNumber(
      record.ambientLightIntensity,
      0,
      6,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.ambientLightIntensity
    ),
    cameraFar,
    cameraFov: normalizePetClampedNumber(record.cameraFov, 10, 90, PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraFov),
    cameraNear,
    cameraPositionX: normalizePetVrmStageWorldCoordinate(
      record.cameraPositionX,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraPositionX
    ),
    cameraPositionY: normalizePetVrmStageWorldCoordinate(
      record.cameraPositionY,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraPositionY
    ),
    cameraPositionZ: normalizePetVrmStageWorldCoordinate(
      record.cameraPositionZ,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraPositionZ
    ),
    cameraTargetX: normalizePetVrmStageWorldCoordinate(
      record.cameraTargetX,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraTargetX
    ),
    cameraTargetY: normalizePetVrmStageWorldCoordinate(
      record.cameraTargetY,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraTargetY
    ),
    cameraTargetZ: normalizePetVrmStageWorldCoordinate(
      record.cameraTargetZ,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.cameraTargetZ
    ),
    fillLightIntensity: normalizePetClampedNumber(
      record.fillLightIntensity,
      0,
      6,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.fillLightIntensity
    ),
    lookAtTargetX: normalizePetVrmStageWorldCoordinate(
      record.lookAtTargetX,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.lookAtTargetX
    ),
    lookAtTargetY: normalizePetVrmStageWorldCoordinate(
      record.lookAtTargetY,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.lookAtTargetY
    ),
    lookAtTargetZ: normalizePetVrmStageWorldCoordinate(
      record.lookAtTargetZ,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.lookAtTargetZ
    ),
    keyLightIntensity: normalizePetClampedNumber(
      record.keyLightIntensity,
      0,
      6,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.keyLightIntensity
    )
  }
}

export type PetTaskKind = 'session'

export type PetTaskStatus = 'running' | 'waiting' | 'review' | 'done' | 'failed' | 'aborted'

export type PetSourceKind = 'agent'

export type PetQueueReason = 'bound-disabled' | 'bound-busy' | 'no-enabled-pet' | 'no-free-pet'

export type PetTaskMessageSummary = {
  id: string
  role: string
  text: string
  createdAt?: string
}

export type PetTaskMessageRender = {
  message: CherryUIMessage
  partsByMessageId: Record<string, CherryMessagePart[]>
}

export type PetTaskBinding = {
  taskKey: string
  kind: PetTaskKind
  targetId: string
  sourceKey: string
  sourceKind: PetSourceKind
  sourceId: string
  sourceTitle: string
  animalId: string
  status: PetTaskStatus
  title: string
  startedAt: number
  updatedAt: number
  endedAt?: number
  currentToolName?: string
  openedInCherry?: boolean
  queueReason?: PetQueueReason
  bubbleDismissed?: boolean
  messages?: PetTaskMessageSummary[]
  render?: PetTaskMessageRender
  streamText?: string
}

export type PetTaskBubbleSnapshot = {
  taskKey: string
  kind: PetTaskKind
  targetId: string
  sourceKey: string
  sourceKind: PetSourceKind
  sourceId: string
  sourceTitle: string
  animalId: string
  status: Extract<PetTaskStatus, 'done' | 'failed' | 'aborted'>
  title: string
  startedAt: number
  updatedAt: number
  endedAt: number
  currentToolName?: string
  openedInCherry?: boolean
  queueReason?: PetQueueReason
  bubbleDismissed?: boolean
  messages?: PetTaskMessageSummary[]
  render?: PetTaskMessageRender
  streamText?: string
}

export type PetPermissionPromptStatus = 'pending'

export type PetPermissionPromptSnapshot = {
  approvalId: string
  sessionId: string
  toolCallId: string
  toolName: string
  taskKey: string
  kind: Extract<PetTaskKind, 'session'>
  targetId: string
  sourceKey: string
  sourceKind: PetSourceKind
  sourceId: string
  sourceTitle: string
  animalId: string
  title: string
  status: PetPermissionPromptStatus
  safePreview: string
  previewRedacted: boolean
  previewTruncated: boolean
  dismissed?: boolean
  createdAt: number
  updatedAt: number
}

export type PetPastureSnapshot = {
  packages: PetPackageInfo[]
  animals: PetAnimalInstance[]
  bindings: PetTaskBinding[]
  queuedTasks: PetTaskBinding[]
  bubbles: PetTaskBubbleSnapshot[]
  permissionPrompts: PetPermissionPromptSnapshot[]
  bounds: PetPastureBounds
  vrmModelProfiles: PetVrmStageModelProfileRecord
  vrmSceneSettings: PetVrmStageSceneSettings
}

export type PetQuickReplyRequest = {
  taskKey: string
  text: string
}

export type PetTaskBubbleHoldState = {
  taskKey: string
  held: boolean
  hasDraft: boolean
}

function normalizePetOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizePetOptionalClampedNumber(value: unknown, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.min(Math.max(Number(value), min), max)
}

function normalizePetClampedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const finiteValue = Number.isFinite(value) ? Number(value) : fallback
  return Math.min(Math.max(finiteValue, min), max)
}

function normalizePetVrmStageCoordinate(value: unknown, fallback: number): number {
  const finiteValue = Number.isFinite(value) ? Number(value) : fallback
  return Math.min(Math.max(finiteValue, -2), 2)
}

function normalizePetVrmStageWorldCoordinate(value: unknown, fallback: number): number {
  return normalizePetClampedNumber(value, -1000, 1000, fallback)
}

function getDefaultPetVrmStageModelPositionZ(order: unknown): number {
  const finiteOrder = Number.isFinite(order) ? Math.max(0, Number(order)) : 0
  return Number((-finiteOrder * 0.02).toFixed(2))
}

function normalizePetVrmStageAnimationPreset(value: unknown): PetVrmStageModelProfile['animationPreset'] {
  return typeof value === 'string' && (PET_VRM_STAGE_ANIMATION_PRESETS as readonly string[]).includes(value)
    ? (value as PetVrmStageModelProfile['animationPreset'])
    : 'vroid-show-full-body'
}

function normalizePetVrmStageExpressionName(value: unknown): PetVrmStageModelProfile['expression'] {
  return typeof value === 'string' && (PET_VRM_STAGE_EXPRESSION_NAMES as readonly string[]).includes(value)
    ? (value as PetVrmStageModelProfile['expression'])
    : 'neutral'
}
