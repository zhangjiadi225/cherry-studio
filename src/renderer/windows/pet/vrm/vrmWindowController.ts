import type { PetWindowBounds, PetWindowResizeEdge, PetWindowResizeRequest } from '@shared/pet'
import { PET_VRM_STAGE_MIN_HEIGHT, PET_VRM_STAGE_MIN_WIDTH } from '@shared/pet'

export function getPetVrmResizeRequest(
  edge: PetWindowResizeEdge,
  bounds: PetWindowBounds,
  deltaX: number,
  deltaY: number
): PetWindowResizeRequest {
  let x = bounds.x
  let y = bounds.y
  let width = bounds.width
  let height = bounds.height

  if (edge.includes('right')) width = bounds.width + deltaX
  if (edge.includes('left')) {
    width = bounds.width - deltaX
    x = bounds.x + deltaX
  }
  if (edge.includes('bottom')) height = bounds.height + deltaY
  if (edge.includes('top')) {
    height = bounds.height - deltaY
    y = bounds.y + deltaY
  }

  width = Math.max(PET_VRM_STAGE_MIN_WIDTH, width)
  height = Math.max(PET_VRM_STAGE_MIN_HEIGHT, height)
  if (edge.includes('left')) x = bounds.x + bounds.width - width
  if (edge.includes('top')) y = bounds.y + bounds.height - height

  return {
    edge,
    height,
    mode: 'vrm-stage',
    width,
    x,
    y
  }
}
