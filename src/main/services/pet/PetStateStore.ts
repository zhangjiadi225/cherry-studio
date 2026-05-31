import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import {
  DEFAULT_PET_PERSONALITY,
  isPetPersonality,
  normalizePetVrmStageModelProfileRecord,
  normalizePetVrmStageSceneSettings,
  PET_PASTURE_DEFAULT_WIDTH,
  PET_VRM_STAGE_DEFAULT_HEIGHT,
  PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  PET_VRM_STAGE_DEFAULT_WIDTH,
  type PetAnimalInstance,
  type PetPastureBounds,
  type PetVrmStageModelProfileRecord,
  type PetVrmStageSceneSettings,
  type PetVrmWindowBounds
} from '@shared/pet'

const PET_STATE_FILE = 'state.json'
const PET_STATE_SCHEMA_VERSION = 1

export type StoredPetState = {
  schemaVersion: 1
  animals: PetAnimalInstance[]
  pastureBounds: PetPastureBounds
  vrm: {
    modelProfiles: PetVrmStageModelProfileRecord
    sceneSettings: PetVrmStageSceneSettings
    windowBounds: PetVrmWindowBounds
  }
}

export class PetStateStore {
  public async read(): Promise<StoredPetState> {
    try {
      const text = await fs.readFile(this.getStatePath(), 'utf8')
      return normalizeStoredPetState(JSON.parse(text))
    } catch {
      return createDefaultPetState()
    }
  }

  public async write(state: StoredPetState): Promise<StoredPetState> {
    const normalized = normalizeStoredPetState(state)
    const statePath = this.getStatePath()
    const tempPath = `${statePath}.${Date.now()}.tmp`
    await fs.mkdir(path.dirname(statePath), { recursive: true })
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
      await fs.rename(tempPath, statePath)
    } catch (error) {
      await fs.rm(tempPath, { force: true })
      throw error
    }
    return normalized
  }

  private getStatePath(): string {
    return path.join(application.getPath('feature.pets'), PET_STATE_FILE)
  }
}

export function createDefaultPetState(): StoredPetState {
  return {
    schemaVersion: PET_STATE_SCHEMA_VERSION,
    animals: [],
    pastureBounds: {
      x: -1,
      y: -1,
      width: PET_PASTURE_DEFAULT_WIDTH
    },
    vrm: {
      modelProfiles: {},
      sceneSettings: { ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS },
      windowBounds: {
        height: PET_VRM_STAGE_DEFAULT_HEIGHT,
        width: PET_VRM_STAGE_DEFAULT_WIDTH,
        x: -1,
        y: -1
      }
    }
  }
}

export function normalizeStoredPetState(input: unknown): StoredPetState {
  const defaults = createDefaultPetState()
  const record = isRecord(input) ? input : {}
  const vrm = isRecord(record.vrm) ? record.vrm : {}

  return {
    schemaVersion: PET_STATE_SCHEMA_VERSION,
    animals: normalizeStoredAnimals(record.animals),
    pastureBounds: normalizeStoredPastureBounds(record.pastureBounds, defaults.pastureBounds),
    vrm: {
      modelProfiles: normalizePetVrmStageModelProfileRecord(vrm.modelProfiles),
      sceneSettings: normalizePetVrmStageSceneSettings(vrm.sceneSettings),
      windowBounds: normalizeStoredVrmWindowBounds(vrm.windowBounds, defaults.vrm.windowBounds)
    }
  }
}

function normalizeStoredAnimals(input: unknown): PetAnimalInstance[] {
  if (!Array.isArray(input)) return []

  return input.filter(isRecord).map((animal, order) => ({
    agentId: typeof animal.agentId === 'string' && animal.agentId.trim() ? animal.agentId.trim() : null,
    createdAt: typeof animal.createdAt === 'string' ? animal.createdAt : '',
    enabled: typeof animal.enabled === 'boolean' ? animal.enabled : true,
    homeXRatio: Number.isFinite(animal.homeXRatio) ? Number(animal.homeXRatio) : 0.5,
    id: typeof animal.id === 'string' ? animal.id : '',
    name: typeof animal.name === 'string' ? animal.name : '',
    order: Number.isFinite(animal.order) ? Number(animal.order) : order,
    packageId: typeof animal.packageId === 'string' ? animal.packageId : '',
    personality: isPetPersonality(animal.personality) ? animal.personality : DEFAULT_PET_PERSONALITY
  }))
}

function normalizeStoredPastureBounds(input: unknown, fallback: PetPastureBounds): PetPastureBounds {
  const record = isRecord(input) ? input : {}
  return {
    x: Number.isFinite(record.x) ? Number(record.x) : fallback.x,
    y: Number.isFinite(record.y) ? Number(record.y) : fallback.y,
    width: Number.isFinite(record.width) ? Number(record.width) : fallback.width
  }
}

function normalizeStoredVrmWindowBounds(input: unknown, fallback: PetVrmWindowBounds): PetVrmWindowBounds {
  const record = isRecord(input) ? input : {}
  return {
    height: Number.isFinite(record.height) ? Number(record.height) : fallback.height,
    width: Number.isFinite(record.width) ? Number(record.width) : fallback.width,
    x: Number.isFinite(record.x) ? Number(record.x) : fallback.x,
    y: Number.isFinite(record.y) ? Number(record.y) : fallback.y
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
