import type { PetVrmStageAnimationPreset } from '@shared/pet'

import vroidGreetingAnimationUrl from './assets/vroid-official/greeting.vrma?url'
import vroidModelPoseAnimationUrl from './assets/vroid-official/model-pose.vrma?url'
import vroidPeaceSignAnimationUrl from './assets/vroid-official/peace-sign.vrma?url'
import vroidShootAnimationUrl from './assets/vroid-official/shoot.vrma?url'
import vroidShowFullBodyAnimationUrl from './assets/vroid-official/show-full-body.vrma?url'
import vroidSpinAnimationUrl from './assets/vroid-official/spin.vrma?url'
import vroidSquatAnimationUrl from './assets/vroid-official/squat.vrma?url'

export const PET_VRM_STAGE_DEFAULT_ANIMATION_PRESET: PetVrmStageAnimationPreset = 'vrm-idle-still'

export type PetVrmStageAnimationPresetDefinition = {
  credit?: string
  id: PetVrmStageAnimationPreset
  url?: string
}

export const PET_VRM_STAGE_ANIMATION_PRESET_DEFINITIONS: readonly PetVrmStageAnimationPresetDefinition[] = [
  {
    id: 'vrm-idle-still'
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-show-full-body',
    url: vroidShowFullBodyAnimationUrl
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-greeting',
    url: vroidGreetingAnimationUrl
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-peace-sign',
    url: vroidPeaceSignAnimationUrl
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-shoot',
    url: vroidShootAnimationUrl
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-spin',
    url: vroidSpinAnimationUrl
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-model-pose',
    url: vroidModelPoseAnimationUrl
  },
  {
    credit: 'VRoid Project',
    id: 'vroid-squat',
    url: vroidSquatAnimationUrl
  }
]

const PET_VRM_STAGE_ANIMATION_PRESET_BY_ID = new Map(
  PET_VRM_STAGE_ANIMATION_PRESET_DEFINITIONS.map((preset) => [preset.id, preset])
)

export function getPetVrmStageAnimationPresetUrl(preset: PetVrmStageAnimationPreset | undefined): string | undefined {
  return (
    PET_VRM_STAGE_ANIMATION_PRESET_BY_ID.get(preset ?? PET_VRM_STAGE_DEFAULT_ANIMATION_PRESET) ??
    PET_VRM_STAGE_ANIMATION_PRESET_BY_ID.get(PET_VRM_STAGE_DEFAULT_ANIMATION_PRESET)!
  ).url
}
