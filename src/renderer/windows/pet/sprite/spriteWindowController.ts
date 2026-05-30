import type { PetPastureResizeEdge, PetPastureResizeRequest, PetWindowBounds } from '@shared/pet'
import { PET_PASTURE_MIN_WIDTH } from '@shared/pet'

export function getPetSpriteResizeRequest(
  edge: PetPastureResizeEdge,
  bounds: PetWindowBounds,
  deltaX: number
): PetPastureResizeRequest {
  if (edge === 'right') {
    return {
      edge,
      x: bounds.x,
      width: Math.max(PET_PASTURE_MIN_WIDTH, bounds.width + deltaX)
    }
  }

  const width = Math.max(PET_PASTURE_MIN_WIDTH, bounds.width - deltaX)
  return {
    edge,
    x: bounds.x + bounds.width - width,
    width
  }
}
