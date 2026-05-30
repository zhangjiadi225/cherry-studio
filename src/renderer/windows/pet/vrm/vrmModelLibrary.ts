import {
  PET_VRM_STAGE_ANIMATION_PRESETS,
  PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  PET_VRM_STAGE_EXPRESSION_NAMES,
  type PetAssetImportRemoteRequest,
  type PetAssetInfo,
  type PetVrmStageModelProfileRecord,
  type PetVrmStageSceneSettings
} from '@shared/pet'

import type {
  PetVrmModelRecord,
  PetVrmModelSummary,
  PetVrmStageModelProfile,
  PetVrmStageModelProfileMap
} from './types'

const PET_VRM_LIBRARY_EVENT = 'cherry:pet-vrm-library-changed'
const PET_VRM_BROADCAST_CHANNEL = 'cherry.pet.vrm.library.v1'

let broadcastChannel: BroadcastChannel | null | undefined

export function isPetVrmStageModelEnabled(
  profile: PetVrmStageModelProfile | undefined | null
): profile is PetVrmStageModelProfile {
  return Boolean(profile?.enabled && profile.modelId)
}

export function createPetVrmStageModelProfile(
  input: Partial<PetVrmStageModelProfile> = {},
  previous?: PetVrmStageModelProfile
): PetVrmStageModelProfile {
  const now = Date.now()
  const modelId = normalizeOptionalString('modelId' in input ? input.modelId : previous?.modelId)
  if (!modelId) throw new Error('VRM model id is required')

  return {
    createdAt: Number.isFinite(input.createdAt) ? Number(input.createdAt) : (previous?.createdAt ?? now),
    animationPreset: normalizeAnimationPreset(input.animationPreset ?? previous?.animationPreset),
    blink: typeof input.blink === 'boolean' ? input.blink : (previous?.blink ?? true),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : (previous?.enabled ?? false),
    expression: normalizeExpressionName(input.expression ?? previous?.expression),
    expressionIntensity: normalizeOptionalClampedNumber(
      input.expressionIntensity ?? previous?.expressionIntensity,
      0,
      1
    ),
    idleMotion: typeof input.idleMotion === 'boolean' ? input.idleMotion : (previous?.idleMotion ?? true),
    lookAtCursor: typeof input.lookAtCursor === 'boolean' ? input.lookAtCursor : (previous?.lookAtCursor ?? true),
    modelId,
    order: Number.isFinite(input.order) ? Number(input.order) : (previous?.order ?? 0),
    positionX: normalizeCoordinate(input.positionX ?? previous?.positionX, 0),
    positionY: normalizeCoordinate(input.positionY ?? previous?.positionY, 0),
    updatedAt: Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : now
  }
}

export function subscribePetVrmLibraryChanges(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleEvent = () => listener()
  window.addEventListener(PET_VRM_LIBRARY_EVENT, handleEvent)

  const channel = getBroadcastChannel()
  channel?.addEventListener('message', handleEvent)

  return () => {
    window.removeEventListener(PET_VRM_LIBRARY_EVENT, handleEvent)
    channel?.removeEventListener('message', handleEvent)
  }
}

export async function listPetVrmModels(): Promise<PetVrmModelSummary[]> {
  const assetApi = getPetAssetApi()
  if (!assetApi?.list) return []

  try {
    return (await assetApi.list({ kind: 'vrm-model' }))
      .map(petVrmModelSummaryFromAsset)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
  } catch {
    return []
  }
}

export async function getPetVrmModel(modelId: string): Promise<PetVrmModelRecord | null> {
  const assetApi = getPetAssetApi()
  if (!assetApi?.resolve) return null

  try {
    const resolved = await assetApi.resolve({ assetId: modelId, kind: 'vrm-model', fileRole: 'model' })
    return resolved ? petVrmModelRecordFromAsset(resolved.asset, resolved.url) : null
  } catch {
    return null
  }
}

export async function savePetVrmModel(file: File): Promise<PetVrmModelSummary> {
  validatePetVrmFile(file)

  const assetApi = getPetAssetApi()
  if (!assetApi?.importFile) {
    throw new Error('Pet asset service is not available')
  }

  const asset = await assetApi.importFile(file, {
    kind: 'vrm-model',
    displayName: stripVrmExtension(file.name),
    mediaType: file.type || 'model/vrm'
  })
  publishPetVrmLibraryChange()
  return petVrmModelSummaryFromAsset(asset)
}

export async function savePetVrmRemoteModel(
  input: Omit<PetAssetImportRemoteRequest, 'kind'>
): Promise<PetVrmModelSummary> {
  const assetApi = getPetAssetApi()
  if (!assetApi?.importRemote) {
    throw new Error('Pet asset service is not available')
  }

  const asset = await assetApi.importRemote({ ...input, kind: 'vrm-model' })
  publishPetVrmLibraryChange()
  return petVrmModelSummaryFromAsset(asset)
}

export async function deletePetVrmModel(modelId: string): Promise<void> {
  const assetApi = getPetAssetApi()
  if (!assetApi?.delete) {
    throw new Error('Pet asset service is not available')
  }

  await assetApi.delete({ assetId: modelId, kind: 'vrm-model' })
  publishPetVrmLibraryChange()
}

export async function createPetVrmModelObjectUrl(
  modelId: string
): Promise<{ record: PetVrmModelRecord; revoke: () => void; url: string } | null> {
  const record = await getPetVrmModel(modelId)
  if (!record) return null

  if (record.sourceUrl.startsWith('file://')) {
    const bytes = await window.api.fs.read(record.sourceUrl)
    const url = URL.createObjectURL(new Blob([bytes], { type: record.type || 'model/vrm' }))

    return {
      record,
      revoke: () => URL.revokeObjectURL(url),
      url
    }
  }

  return {
    record,
    revoke: () => {},
    url: record.sourceUrl
  }
}

export function normalizePetVrmStageModelProfile(
  key: string,
  profile: Partial<PetVrmStageModelProfile> | undefined | null
): PetVrmStageModelProfile | null {
  if (!profile || typeof profile !== 'object') return null
  const modelId = normalizeOptionalString(profile.modelId) ?? normalizeOptionalString(key)
  if (!modelId) return null
  return createPetVrmStageModelProfile({ ...profile, modelId })
}

export function petVrmStageModelProfilesFromRecord(
  record: Partial<PetVrmStageModelProfileRecord> | undefined | null
): PetVrmStageModelProfileMap {
  const profiles: PetVrmStageModelProfileMap = new Map()
  if (!record || typeof record !== 'object') return profiles

  for (const [key, profile] of Object.entries(record)) {
    const normalized = normalizePetVrmStageModelProfile(key, profile)
    if (normalized && !profiles.has(normalized.modelId)) {
      profiles.set(normalized.modelId, normalized)
    }
  }

  return profiles
}

export function petVrmStageModelProfilesToRecord(profiles: PetVrmStageModelProfileMap): PetVrmStageModelProfileRecord {
  const record: PetVrmStageModelProfileRecord = {}
  for (const profile of profiles.values()) {
    record[profile.modelId] = profile
  }
  return record
}

export function normalizePetVrmStageSceneSettings(input: unknown): PetVrmStageSceneSettings {
  const record = input && typeof input === 'object' ? (input as Partial<PetVrmStageSceneSettings>) : {}

  return {
    ambientLightIntensity: normalizeClampedNumber(
      record.ambientLightIntensity,
      0,
      6,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.ambientLightIntensity
    ),
    fillLightIntensity: normalizeClampedNumber(
      record.fillLightIntensity,
      0,
      6,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.fillLightIntensity
    ),
    keyLightIntensity: normalizeClampedNumber(
      record.keyLightIntensity,
      0,
      6,
      PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS.keyLightIntensity
    )
  }
}

function validatePetVrmFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.vrm')) {
    throw new Error('Only .vrm files are supported')
  }
}

function petVrmModelSummaryFromAsset(asset: PetAssetInfo): PetVrmModelSummary {
  const modelFile = asset.files.find((file) => file.role === 'model')
  return {
    id: asset.id,
    importedAt: asset.createdAt,
    lastModified: asset.updatedAt,
    name: asset.originalFileName || `${asset.displayName}.vrm`,
    size: asset.sizeBytes ?? modelFile?.sizeBytes ?? 0,
    type: modelFile?.mediaType || 'model/vrm',
    updatedAt: asset.updatedAt
  }
}

function petVrmModelRecordFromAsset(asset: PetAssetInfo, sourceUrl: string): PetVrmModelRecord {
  return {
    ...petVrmModelSummaryFromAsset(asset),
    sourceUrl
  }
}

function getPetAssetApi(): Window['api']['pet']['assets'] | null {
  try {
    return typeof window !== 'undefined' ? (window.api?.pet?.assets ?? null) : null
  } catch {
    return null
  }
}

function stripVrmExtension(name: string): string {
  return name.replace(/\.vrm$/i, '')
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeOptionalClampedNumber(value: unknown, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.min(Math.max(Number(value), min), max)
}

function normalizeClampedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const finiteValue = Number.isFinite(value) ? Number(value) : fallback
  return Math.min(Math.max(finiteValue, min), max)
}

function normalizeCoordinate(value: unknown, fallback: number): number {
  const finiteValue = Number.isFinite(value) ? Number(value) : fallback
  return Math.min(Math.max(finiteValue, -2), 2)
}

function normalizeAnimationPreset(value: unknown): PetVrmStageModelProfile['animationPreset'] {
  return typeof value === 'string' && (PET_VRM_STAGE_ANIMATION_PRESETS as readonly string[]).includes(value)
    ? (value as PetVrmStageModelProfile['animationPreset'])
    : 'vroid-show-full-body'
}

function normalizeExpressionName(value: unknown): PetVrmStageModelProfile['expression'] {
  return typeof value === 'string' && (PET_VRM_STAGE_EXPRESSION_NAMES as readonly string[]).includes(value)
    ? (value as PetVrmStageModelProfile['expression'])
    : 'neutral'
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel !== undefined) return broadcastChannel
  try {
    broadcastChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PET_VRM_BROADCAST_CHANNEL)
  } catch {
    broadcastChannel = null
  }
  return broadcastChannel
}

function publishPetVrmLibraryChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PET_VRM_LIBRARY_EVENT))
  }
  getBroadcastChannel()?.postMessage({ type: 'changed' })
}
