import { describe, expect, it, vi } from 'vitest'

import { getPetVrmStageAnimationPresetUrl, PET_VRM_STAGE_ANIMATION_PRESET_DEFINITIONS } from '../vrmAnimationPresets'

vi.mock('../assets/vroid-official/greeting.vrma?url', () => ({ default: 'vroid-greeting.vrma' }))
vi.mock('../assets/vroid-official/model-pose.vrma?url', () => ({ default: 'vroid-model-pose.vrma' }))
vi.mock('../assets/vroid-official/peace-sign.vrma?url', () => ({ default: 'vroid-peace-sign.vrma' }))
vi.mock('../assets/vroid-official/shoot.vrma?url', () => ({ default: 'vroid-shoot.vrma' }))
vi.mock('../assets/vroid-official/show-full-body.vrma?url', () => ({ default: 'vroid-show-full-body.vrma' }))
vi.mock('../assets/vroid-official/spin.vrma?url', () => ({ default: 'vroid-spin.vrma' }))
vi.mock('../assets/vroid-official/squat.vrma?url', () => ({ default: 'vroid-squat.vrma' }))

describe('vrmAnimationPresets', () => {
  it('registers the quiet built-in idle preset and seven official VRoid VRMA motions', () => {
    expect(PET_VRM_STAGE_ANIMATION_PRESET_DEFINITIONS.map((preset) => preset.id)).toEqual([
      'vrm-idle-still',
      'vroid-show-full-body',
      'vroid-greeting',
      'vroid-peace-sign',
      'vroid-shoot',
      'vroid-spin',
      'vroid-model-pose',
      'vroid-squat'
    ])
    expect(getPetVrmStageAnimationPresetUrl('vrm-idle-still')).toBeUndefined()
    expect(getPetVrmStageAnimationPresetUrl('vroid-greeting')).toBe('vroid-greeting.vrma')
    expect(getPetVrmStageAnimationPresetUrl('unknown' as never)).toBeUndefined()
  })
})
