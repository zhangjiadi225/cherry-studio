import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPetVrmModelObjectUrl,
  createPetVrmStageModelProfile,
  isPetVrmStageModelEnabled,
  normalizePetVrmStageSceneSettings,
  petVrmStageModelProfilesFromRecord,
  petVrmStageModelProfilesToRecord
} from '../vrmModelLibrary'

const mocks = vi.hoisted(() => ({
  createObjectUrl: vi.fn(),
  fsRead: vi.fn(),
  resolveAsset: vi.fn(),
  revokeObjectUrl: vi.fn()
}))

const vrmAsset = {
  createdAt: 1,
  displayName: 'Avatar Sample',
  files: [{ mediaType: 'model/vrm', relativePath: 'model.vrm', role: 'model' as const, sizeBytes: 3 }],
  id: 'model-a',
  kind: 'vrm-model' as const,
  originalFileName: 'avatar.vrm',
  sizeBytes: 3,
  updatedAt: 2
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createObjectUrl.mockReturnValue('blob:vrm-model')
  mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))

  Object.assign(window, {
    api: {
      fs: { read: mocks.fsRead },
      pet: { assets: { resolve: mocks.resolveAsset } }
    }
  })

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: mocks.createObjectUrl
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: mocks.revokeObjectUrl
  })
})

describe('vrm stage model profiles', () => {
  it('normalizes minimal VRM display settings without agent or personality data', () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 1,
      positionX: -0.45,
      positionY: 0.2,
      positionZ: -0.1
    })

    const profiles = petVrmStageModelProfilesFromRecord({ 'model-a': profile })

    expect(profiles.get('model-a')).toMatchObject({
      enabled: true,
      modelId: 'model-a',
      order: 1,
      positionX: -0.45,
      positionY: 0.2,
      positionZ: -0.1
    })
    expect(profiles.get('model-a')).not.toHaveProperty('agentId')
    expect(profiles.get('model-a')).not.toHaveProperty('personality')
  })

  it('treats disabled VRM models as inactive', () => {
    const record = petVrmStageModelProfilesToRecord(
      new Map([
        [
          'model-a',
          createPetVrmStageModelProfile({
            enabled: false,
            modelId: 'model-a'
          })
        ]
      ])
    )
    const profiles = petVrmStageModelProfilesFromRecord(record)

    expect(isPetVrmStageModelEnabled(profiles.get('model-a'))).toBe(false)
  })

  it('can enable a saved model without adding behavior bindings', () => {
    const profile = createPetVrmStageModelProfile({
      enabled: false,
      modelId: 'model-a'
    })
    const enabled = createPetVrmStageModelProfile({ enabled: true }, profile)

    expect(enabled).toMatchObject({
      enabled: true,
      modelId: 'model-a'
    })
    expect(isPetVrmStageModelEnabled(enabled)).toBe(true)
  })

  it('fills pure 3D runtime defaults for saved models', () => {
    const profile = createPetVrmStageModelProfile({
      modelId: 'model-a'
    })

    expect(profile).toMatchObject({
      animationPreset: 'vroid-show-full-body',
      blink: true,
      expression: 'neutral',
      idleMotion: true,
      lookAtCursor: true,
      modelId: 'model-a',
      positionX: 0,
      positionY: 0,
      positionZ: 0
    })
  })

  it('normalizes VRM animation presets', () => {
    const profile = createPetVrmStageModelProfile({
      animationPreset: 'vroid-greeting',
      modelId: 'model-a'
    })
    const fallback = createPetVrmStageModelProfile({
      animationPreset: 'unknown' as never,
      modelId: 'model-b'
    })

    expect(profile.animationPreset).toBe('vroid-greeting')
    expect(fallback.animationPreset).toBe('vroid-show-full-body')
  })

  it('normalizes VRM scene settings', () => {
    expect(
      normalizePetVrmStageSceneSettings({
        ambientLightIntensity: 999,
        fillLightIntensity: 8,
        keyLightIntensity: 3.4
      })
    ).toEqual({
      ambientLightIntensity: 6,
      fillLightIntensity: 6,
      keyLightIntensity: 3.4
    })
  })
})

describe('VRM model object URLs', () => {
  it('converts managed file URLs to blob URLs for the GLTF loader', async () => {
    mocks.resolveAsset.mockResolvedValue({
      asset: vrmAsset,
      url: 'file:///C:/Users/62501/AppData/Roaming/CherryStudioDev/Data/Pets/assets/vrm/models/model-a/model.vrm'
    })

    const result = await createPetVrmModelObjectUrl('model-a')

    expect(mocks.resolveAsset).toHaveBeenCalledWith({ assetId: 'model-a', fileRole: 'model', kind: 'vrm-model' })
    expect(mocks.fsRead).toHaveBeenCalledWith(
      'file:///C:/Users/62501/AppData/Roaming/CherryStudioDev/Data/Pets/assets/vrm/models/model-a/model.vrm'
    )
    expect(mocks.createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(result?.url).toBe('blob:vrm-model')

    result?.revoke()

    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith('blob:vrm-model')
  })

  it('keeps remote model URLs unchanged', async () => {
    mocks.resolveAsset.mockResolvedValue({
      asset: vrmAsset,
      url: 'https://example.com/avatar.vrm'
    })

    const result = await createPetVrmModelObjectUrl('model-a')

    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.createObjectUrl).not.toHaveBeenCalled()
    expect(result?.url).toBe('https://example.com/avatar.vrm')

    result?.revoke()

    expect(mocks.revokeObjectUrl).not.toHaveBeenCalled()
  })
})
