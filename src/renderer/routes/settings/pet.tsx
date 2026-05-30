import PetSettings from '@renderer/pages/settings/PetSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/pet')({
  component: PetSettings
})
