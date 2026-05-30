import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'
import '@renderer/i18n'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import PetWindowApp from './PetWindowApp'

loggerService.initWindowSource('PetWindow')
await preferenceService.preload([
  'feature.pet.dnd_enabled',
  'feature.pet.mode',
  'feature.pet.scale',
  'feature.pet.vrm.model_profiles',
  'feature.pet.vrm.scene_settings'
])

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<PetWindowApp />)
