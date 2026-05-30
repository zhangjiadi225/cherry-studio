import {
  PET_PASTURE_DEFAULT_WIDTH,
  PET_PASTURE_MAX_WIDTH,
  PET_PASTURE_MIN_WIDTH,
  PET_WINDOW_HEIGHT,
  type PetWindowBounds
} from '@shared/pet'
import type { Display, Point, Rectangle } from 'electron'

export function clampPetPastureWidth(width: number, workAreaWidth: number): number {
  const finiteWidth = Number.isFinite(width) ? width : PET_PASTURE_DEFAULT_WIDTH
  return Math.round(Math.min(Math.max(finiteWidth, PET_PASTURE_MIN_WIDTH), workAreaWidth, PET_PASTURE_MAX_WIDTH))
}

export function getPetPastureDisplayPoint(
  x: number,
  width: number,
  y: number | undefined,
  fallbackDisplay: Display
): Point {
  const workArea = fallbackDisplay.workArea
  const centerX = Number.isFinite(x) ? x + width / 2 : workArea.x + workArea.width / 2
  const centerY =
    typeof y === 'number' && Number.isFinite(y) && y >= 0
      ? y + PET_WINDOW_HEIGHT / 2
      : getPetPastureBottomY(workArea) + PET_WINDOW_HEIGHT / 2

  return {
    x: Math.round(centerX),
    y: Math.round(centerY)
  }
}

export function resolvePetPastureBounds(display: Display, x: number, requestedWidth: number): PetWindowBounds {
  const workArea = display.workArea
  const width = clampPetPastureWidth(requestedWidth, workArea.width)
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)

  return {
    x: Math.round(Math.min(Math.max(x, workArea.x), maxX)),
    y: getPetPastureBottomY(workArea),
    width,
    height: PET_WINDOW_HEIGHT
  }
}

function getPetPastureBottomY(workArea: Rectangle): number {
  return Math.round(workArea.y + workArea.height - PET_WINDOW_HEIGHT)
}
