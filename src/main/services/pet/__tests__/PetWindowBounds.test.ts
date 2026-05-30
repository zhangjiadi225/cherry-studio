import { PET_PASTURE_MAX_WIDTH, PET_PASTURE_MIN_WIDTH, PET_WINDOW_HEIGHT } from '@shared/pet'
import type { Display } from 'electron'
import { describe, expect, it } from 'vitest'

import { getPetPastureDisplayPoint, resolvePetPastureBounds } from '../PetWindowBounds'

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  workArea: { x: 0, y: 24, width: 1440, height: 876 },
  scaleFactor: 1,
  rotation: 0,
  touchSupport: 'unknown',
  accelerometerSupport: 'unknown',
  monochrome: false,
  colorDepth: 24,
  colorSpace: '{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}',
  depthPerComponent: 8,
  displayFrequency: 60,
  internal: false,
  label: '',
  maximumCursorSize: { width: 0, height: 0 },
  nativeOrigin: { x: 0, y: 0 },
  size: { width: 1440, height: 900 },
  workAreaSize: { width: 1440, height: 876 }
} as Display

describe('PetWindowBounds', () => {
  it('pins the pasture to the bottom of the display work area', () => {
    expect(resolvePetPastureBounds(display, 400, 640)).toEqual({
      x: 400,
      y: 580,
      width: 640,
      height: PET_WINDOW_HEIGHT
    })
  })

  it('clamps width and x without changing height', () => {
    expect(resolvePetPastureBounds(display, -50, 100)).toEqual({
      x: 0,
      y: 580,
      width: PET_PASTURE_MIN_WIDTH,
      height: PET_WINDOW_HEIGHT
    })
    expect(resolvePetPastureBounds(display, 1300, 640)).toMatchObject({
      x: 800,
      width: 640,
      height: PET_WINDOW_HEIGHT
    })
  })

  it('caps the pasture width at the long background width even on wider displays', () => {
    const wideDisplay = {
      ...display,
      workArea: { ...display.workArea, width: 3440 },
      workAreaSize: { width: 3440, height: display.workArea.height }
    } as Display

    expect(resolvePetPastureBounds(wideDisplay, 120, 3200)).toMatchObject({
      x: 120,
      width: PET_PASTURE_MAX_WIDTH,
      height: PET_WINDOW_HEIGHT
    })
  })

  it('uses the current vertical position only for display lookup', () => {
    expect(getPetPastureDisplayPoint(100, 640, 500, display)).toEqual({
      x: 420,
      y: 660
    })
    expect(getPetPastureDisplayPoint(100, 640, undefined, display)).toEqual({
      x: 420,
      y: 740
    })
  })
})
