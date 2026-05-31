import { usePreference } from '@data/hooks/usePreference'
import { PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS, type PetSceneMode, type PetVrmStageSceneSettings } from '@shared/pet'
import { isPetSceneMode } from '@shared/pet'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PetVrmStageModelProfile, PetVrmStageModelProfileMap } from '../windows/pet/vrm/types'
import {
  normalizePetVrmStageSceneSettings,
  petVrmStageModelProfilesFromRecord
} from '../windows/pet/vrm/vrmModelLibrary'

const DEFAULT_PET_SCENE_MODE: PetSceneMode = 'sprite-pasture'

export function usePetSceneModePreference(): [PetSceneMode, (mode: PetSceneMode) => Promise<void>] {
  const [mode, setMode] = usePreference('feature.pet.mode')

  return [isPetSceneMode(mode) ? mode : DEFAULT_PET_SCENE_MODE, setMode]
}

export function usePetVrmStageModelProfiles(): {
  deleteProfile: (modelId: string) => Promise<PetVrmStageModelProfileMap>
  profiles: PetVrmStageModelProfileMap
  saveProfile: (profile: PetVrmStageModelProfile) => Promise<PetVrmStageModelProfileMap>
  setProfiles: (profiles: PetVrmStageModelProfileMap) => Promise<void>
} {
  const [profiles, setProfilesState] = useState<PetVrmStageModelProfileMap>(() => new Map())

  const setProfiles = useCallback(
    async (nextProfiles: PetVrmStageModelProfileMap) => {
      const deletedModelIds = [...profiles.keys()].filter((modelId) => !nextProfiles.has(modelId))
      await Promise.all(deletedModelIds.map((modelId) => window.api.pet.vrm.deleteStageModelProfile(modelId)))
      await Promise.all([...nextProfiles.values()].map((profile) => window.api.pet.vrm.setStageModelProfile(profile)))
      setProfilesState(new Map(nextProfiles))
    },
    [profiles]
  )

  const saveProfile = useCallback(
    async (profile: PetVrmStageModelProfile) => {
      const nextProfiles: PetVrmStageModelProfileMap = new Map(profiles)
      const savedProfile = await window.api.pet.vrm.setStageModelProfile({ ...profile, updatedAt: Date.now() })
      nextProfiles.set(savedProfile.modelId, savedProfile)
      setProfilesState(nextProfiles)
      return nextProfiles
    },
    [profiles]
  )

  const deleteProfile = useCallback(
    async (modelId: string) => {
      const nextProfiles: PetVrmStageModelProfileMap = new Map(profiles)
      nextProfiles.delete(modelId)
      await window.api.pet.vrm.deleteStageModelProfile(modelId)
      setProfilesState(nextProfiles)
      return nextProfiles
    },
    [profiles]
  )

  useEffect(() => {
    let mounted = true
    void window.api.pet.vrm
      .getStageConfig()
      .then((config) => {
        if (!mounted) return
        setProfilesState(petVrmStageModelProfilesFromRecord(config.modelProfiles))
      })
      .catch(() => {})
    const offPastureChanged = window.api.pet.onPastureChanged((snapshot) => {
      setProfilesState(petVrmStageModelProfilesFromRecord(snapshot.vrmModelProfiles))
    })
    return () => {
      mounted = false
      offPastureChanged()
    }
  }, [])

  return { deleteProfile, profiles, saveProfile, setProfiles }
}

export function usePetVrmStageSceneSettings(): [
  PetVrmStageSceneSettings,
  (settings: PetVrmStageSceneSettings) => Promise<void>
] {
  const [settings, setSettingsState] = useState<PetVrmStageSceneSettings>(() => PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS)

  const setSettings = useCallback(async (nextSettings: PetVrmStageSceneSettings) => {
    const savedSettings = await window.api.pet.vrm.setStageSceneSettings(nextSettings)
    setSettingsState(normalizePetVrmStageSceneSettings(savedSettings))
  }, [])

  useEffect(() => {
    let mounted = true
    void window.api.pet.vrm
      .getStageConfig()
      .then((config) => {
        if (!mounted) return
        setSettingsState(normalizePetVrmStageSceneSettings(config.sceneSettings))
      })
      .catch(() => {})
    const offPastureChanged = window.api.pet.onPastureChanged((snapshot) => {
      setSettingsState(normalizePetVrmStageSceneSettings(snapshot.vrmSceneSettings))
    })
    return () => {
      mounted = false
      offPastureChanged()
    }
  }, [])

  return [useMemo(() => normalizePetVrmStageSceneSettings(settings), [settings]), setSettings]
}
