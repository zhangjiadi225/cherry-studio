import { usePreference } from '@data/hooks/usePreference'
import type { PetSceneMode, PetVrmStageSceneSettings } from '@shared/pet'
import { isPetSceneMode } from '@shared/pet'
import { useCallback, useMemo } from 'react'

import type { PetVrmStageModelProfile, PetVrmStageModelProfileMap } from '../windows/pet/vrm/types'
import {
  normalizePetVrmStageSceneSettings,
  petVrmStageModelProfilesFromRecord,
  petVrmStageModelProfilesToRecord
} from '../windows/pet/vrm/vrmModelLibrary'

const DEFAULT_PET_SCENE_MODE: PetSceneMode = 'sprite-pasture'

export function usePetSceneModePreference(): [PetSceneMode, (mode: PetSceneMode) => Promise<void>] {
  const [mode, setMode] = usePreference('feature.pet.mode')

  return [isPetSceneMode(mode) ? mode : DEFAULT_PET_SCENE_MODE, setMode]
}

export function usePetVrmStageModelProfilesPreference(): {
  deleteProfile: (modelId: string) => Promise<PetVrmStageModelProfileMap>
  profiles: PetVrmStageModelProfileMap
  saveProfile: (profile: PetVrmStageModelProfile) => Promise<PetVrmStageModelProfileMap>
  setProfiles: (profiles: PetVrmStageModelProfileMap) => Promise<void>
} {
  const [profileRecord, setProfileRecord] = usePreference('feature.pet.vrm.model_profiles')

  const profiles = useMemo(() => petVrmStageModelProfilesFromRecord(profileRecord), [profileRecord])

  const setProfiles = useCallback(
    async (nextProfiles: PetVrmStageModelProfileMap) => {
      await setProfileRecord(petVrmStageModelProfilesToRecord(nextProfiles))
    },
    [setProfileRecord]
  )

  const saveProfile = useCallback(
    async (profile: PetVrmStageModelProfile) => {
      const nextProfiles: PetVrmStageModelProfileMap = new Map(profiles)
      nextProfiles.set(profile.modelId, { ...profile, updatedAt: Date.now() })
      await setProfiles(nextProfiles)
      return nextProfiles
    },
    [profiles, setProfiles]
  )

  const deleteProfile = useCallback(
    async (modelId: string) => {
      const nextProfiles: PetVrmStageModelProfileMap = new Map(profiles)
      nextProfiles.delete(modelId)
      await setProfiles(nextProfiles)
      return nextProfiles
    },
    [profiles, setProfiles]
  )

  return { deleteProfile, profiles, saveProfile, setProfiles }
}

export function usePetVrmStageSceneSettingsPreference(): [
  PetVrmStageSceneSettings,
  (settings: PetVrmStageSceneSettings) => Promise<void>
] {
  const [settings, setSettings] = usePreference('feature.pet.vrm.scene_settings')

  return [useMemo(() => normalizePetVrmStageSceneSettings(settings), [settings]), setSettings]
}
