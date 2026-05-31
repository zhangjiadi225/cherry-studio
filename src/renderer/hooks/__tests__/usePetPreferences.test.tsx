import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { createPetVrmStageModelProfile } from '../../windows/pet/vrm/vrmModelLibrary'
import {
  usePetSceneModePreference,
  usePetVrmStageModelProfilesPreference,
  usePetVrmStageSceneSettingsPreference
} from '../usePetPreferences'

describe('usePetPreferences', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
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

  it('writes VRM stage model profile updates through Preference', async () => {
    const { result } = renderHook(() => usePetVrmStageModelProfilesPreference())

    await act(async () => {
      await result.current.saveProfile(
        createPetVrmStageModelProfile({
          enabled: true,
          modelId: 'model-a',
          order: 0
        })
      )
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.vrm.model_profiles')).toMatchObject({
      'model-a': {
        enabled: true,
        modelId: 'model-a',
        positionZ: 0
      }
    })
  })

  it('normalizes VRM stage scene settings from Preference', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.vrm.scene_settings', {
      ambientLightIntensity: 999,
      fillLightIntensity: 8,
      keyLightIntensity: 3.4
    })

    const { result } = renderHook(() => usePetVrmStageSceneSettingsPreference())

    expect(result.current[0]).toEqual({
      ambientLightIntensity: 6,
      fillLightIntensity: 6,
      keyLightIntensity: 3.4
    })
  })
})
