import { PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS, type PetVrmStageSceneSettings } from '@shared/pet'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPetVrmStageModelProfile } from '../../windows/pet/vrm/vrmModelLibrary'
import {
  usePetSceneModePreference,
  usePetVrmStageModelProfiles,
  usePetVrmStageSceneSettings
} from '../usePetPreferences'

describe('usePetPreferences', () => {
  let stageConfig: {
    modelProfiles: Record<string, ReturnType<typeof createPetVrmStageModelProfile>>
    sceneSettings: PetVrmStageSceneSettings
  }

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    stageConfig = {
      modelProfiles: {},
      sceneSettings: { ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS }
    }
    Object.assign(window, {
      api: {
        ...window.api,
        pet: {
          ...window.api?.pet,
          onPastureChanged: vi.fn(() => vi.fn()),
          vrm: {
            deleteStageModelProfile: vi.fn(async (modelId: string) => {
              delete stageConfig.modelProfiles[modelId]
            }),
            getStageConfig: vi.fn(async () => stageConfig),
            setStageModelProfile: vi.fn(async (profile: ReturnType<typeof createPetVrmStageModelProfile>) => {
              stageConfig.modelProfiles[profile.modelId] = profile
              return profile
            }),
            setStageSceneSettings: vi.fn(async (settings: typeof stageConfig.sceneSettings) => {
              stageConfig.sceneSettings = settings
              return settings
            })
          }
        }
      }
    })
  })

  it('reads scene mode from Preference', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.mode', 'vrm-stage')

    const { result } = renderHook(() => usePetSceneModePreference())

    expect(result.current[0]).toBe('vrm-stage')
  })

  it('falls back to sprite pasture for invalid scene mode values', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.mode', 'unknown')

    const { result } = renderHook(() => usePetSceneModePreference())

    expect(result.current[0]).toBe('sprite-pasture')
  })

  it('writes VRM stage model profile updates through the pet API', async () => {
    const { result } = renderHook(() => usePetVrmStageModelProfiles())

    await act(async () => {
      await result.current.saveProfile(
        createPetVrmStageModelProfile({
          enabled: true,
          modelId: 'model-a',
          order: 0
        })
      )
    })

    expect(window.api.pet.vrm.setStageModelProfile).toHaveBeenCalled()
    expect(stageConfig.modelProfiles).toMatchObject({
      'model-a': {
        enabled: true,
        modelId: 'model-a',
        positionZ: 0
      }
    })
  })

  it('normalizes VRM stage scene settings from the pet API', async () => {
    stageConfig.sceneSettings = {
      ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
      ambientLightIntensity: 999,
      fillLightIntensity: 8,
      keyLightIntensity: 3.4
    }

    const { result } = renderHook(() => usePetVrmStageSceneSettings())

    await waitFor(() => {
      expect(result.current[0]).toEqual({
        ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
        ambientLightIntensity: 6,
        fillLightIntensity: 6,
        keyLightIntensity: 3.4
      })
    })
  })
})
