import {
  createPetVrmStageModelProfile,
  normalizePetVrmStageModelProfile,
  normalizePetVrmStageSceneSettings,
  type PetAssetImportRemoteRequest,
  type PetAssetInfo,
  type PetVrmStageModelProfileRecord
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

export { createPetVrmStageModelProfile, normalizePetVrmStageModelProfile, normalizePetVrmStageSceneSettings }

export function isPetVrmStageModelEnabled(
  profile: PetVrmStageModelProfile | undefined | null
): profile is PetVrmStageModelProfile {
  return Boolean(profile?.enabled && profile.modelId)
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
