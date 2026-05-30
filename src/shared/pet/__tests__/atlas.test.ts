import {
  getPetAnimationDuration,
  getPetAtlasFrame,
  getPetDimensions,
  getPetPackageAnimation,
  getPetPackageSpritesheetHeight,
  isPetAnimationName,
  PET_ANIMAL_HEIGHT,
  PET_ANIMAL_WIDTH,
  PET_ANIMATIONS,
  PET_ATLAS_COLUMNS,
  PET_DEFAULT_SCALE,
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  PET_GROUND_HIT_HEIGHT,
  PET_MAX_SCALE,
  PET_MIN_SCALE,
  PET_PASTURE_DEFAULT_WIDTH,
  PET_PASTURE_GROUND_BOTTOM_OFFSET,
  PET_PASTURE_HEIGHT,
  PET_PASTURE_MAX_WIDTH,
  PET_PASTURE_MIN_WIDTH,
  PET_REPLY_MAX_HEIGHT,
  PET_SPRITESHEET_HEIGHT,
  PET_SPRITESHEET_WIDTH,
  PET_VRM_STAGE_DEFAULT_HEIGHT,
  PET_VRM_STAGE_DEFAULT_WIDTH,
  PET_VRM_STAGE_MIN_HEIGHT,
  PET_VRM_STAGE_MIN_WIDTH,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH,
  resolvePetRuntimeClip
} from '@shared/pet'
import { describe, expect, it } from 'vitest'

describe('pet atlas', () => {
  it('uses the Codex 8x9 atlas dimensions', () => {
    expect(PET_ATLAS_COLUMNS).toBe(8)
    expect(PET_SPRITESHEET_WIDTH).toBe(1536)
    expect(PET_SPRITESHEET_HEIGHT).toBe(1872)
    expect(PET_PASTURE_MIN_WIDTH).toBe(360)
    expect(PET_PASTURE_DEFAULT_WIDTH).toBe(640)
    expect(PET_PASTURE_MAX_WIDTH).toBe(2560)
    expect(PET_PASTURE_HEIGHT).toBe(200)
    expect(PET_WINDOW_WIDTH).toBe(PET_PASTURE_DEFAULT_WIDTH)
    expect(PET_WINDOW_HEIGHT).toBe(320)
    expect(PET_WINDOW_HEIGHT).toBeGreaterThan(PET_PASTURE_HEIGHT)
    expect(PET_VRM_STAGE_DEFAULT_WIDTH).toBe(450)
    expect(PET_VRM_STAGE_DEFAULT_HEIGHT).toBe(600)
    expect(PET_VRM_STAGE_MIN_WIDTH).toBe(100)
    expect(PET_VRM_STAGE_MIN_HEIGHT).toBe(200)
    expect(PET_PASTURE_GROUND_BOTTOM_OFFSET).toBe(0)
    expect(PET_GROUND_HIT_HEIGHT).toBe(48)
    expect(PET_REPLY_MAX_HEIGHT).toBe(172)
  })

  it('keeps the scaled pet inside the fixed-height pasture at the ground line', () => {
    expect(PET_ANIMAL_HEIGHT + PET_PASTURE_GROUND_BOTTOM_OFFSET).toBeLessThanOrEqual(PET_PASTURE_HEIGHT)
  })

  it('calculates bounded pet dimensions from user scale', () => {
    expect(getPetDimensions(PET_DEFAULT_SCALE)).toEqual({
      width: PET_ANIMAL_WIDTH,
      height: PET_ANIMAL_HEIGHT
    })
    expect(getPetDimensions(PET_MIN_SCALE).height + PET_PASTURE_GROUND_BOTTOM_OFFSET).toBeLessThanOrEqual(
      PET_PASTURE_HEIGHT
    )
    expect(getPetDimensions(PET_MAX_SCALE)).toEqual({
      width: Math.round(PET_FRAME_WIDTH * PET_MAX_SCALE),
      height: Math.round(PET_FRAME_HEIGHT * PET_MAX_SCALE)
    })
    expect(getPetDimensions(Number.POSITIVE_INFINITY)).toEqual(getPetDimensions(PET_DEFAULT_SCALE))
  })

  it('uses the Codex animation frame counts and durations', () => {
    expect(PET_ANIMATIONS.idle.frameCount).toBe(6)
    expect(PET_ANIMATIONS.waving.frameCount).toBe(4)
    expect(PET_ANIMATIONS.jumping.frameCount).toBe(5)
    expect(PET_ANIMATIONS.review.frameCount).toBe(6)
    expect(getPetAnimationDuration('waving')).toBe(700)
  })

  it('calculates frame offsets by animation row', () => {
    expect(getPetAtlasFrame('idle', 0)).toEqual({
      x: 0,
      y: 0,
      width: PET_FRAME_WIDTH,
      height: PET_FRAME_HEIGHT
    })
    expect(getPetAtlasFrame('review', 5)).toEqual({
      x: PET_FRAME_WIDTH * 5,
      y: PET_FRAME_HEIGHT * 8,
      width: PET_FRAME_WIDTH,
      height: PET_FRAME_HEIGHT
    })
  })

  it('wraps frame indexes inside each animation row', () => {
    expect(getPetAtlasFrame('waving', 4)).toEqual(getPetAtlasFrame('waving', 0))
    expect(getPetAtlasFrame('waving', -1)).toEqual(getPetAtlasFrame('waving', 3))
  })

  it('validates supported animation names', () => {
    expect(isPetAnimationName('running-right')).toBe(true)
    expect(isPetAnimationName('unknown')).toBe(false)
  })

  it('resolves package animation overrides with legacy fallbacks', () => {
    expect(
      getPetPackageAnimation(
        {
          animations: {
            celebrate: { row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false }
          }
        },
        'celebrate'
      )
    ).toEqual({ row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false })

    expect(getPetPackageAnimation({}, 'observe')).toBe(PET_ANIMATIONS.idle)
    expect(getPetPackageAnimation({}, 'walkLeft')).toBe(PET_ANIMATIONS['running-left'])
    expect(getPetPackageSpritesheetHeight({})).toBe(PET_SPRITESHEET_HEIGHT)
    expect(
      getPetPackageSpritesheetHeight({
        animations: {
          celebrate: { row: 9, frameCount: 5, frameDurations: [120, 120, 120, 120, 240], loop: false }
        }
      })
    ).toBe(PET_FRAME_HEIGHT * 10)
  })

  it('resolves Codex atlas animations to runtime clips', () => {
    const clip = resolvePetRuntimeClip(
      {
        spriteUrl: 'file:///pet/spritesheet.webp'
      },
      'walkRight'
    )

    expect(clip).toMatchObject({
      loop: true,
      phaseKey: 'codex-atlas:walkRight'
    })
    expect(clip.frameDurations).toEqual(PET_ANIMATIONS['running-right'].frameDurations)
    expect(clip.frames[0]).toEqual({
      imageUrl: 'file:///pet/spritesheet.webp',
      x: 0,
      y: PET_FRAME_HEIGHT,
      width: PET_FRAME_WIDTH,
      height: PET_FRAME_HEIGHT
    })
    expect(clip.frames.at(-1)).toEqual({
      imageUrl: 'file:///pet/spritesheet.webp',
      x: PET_FRAME_WIDTH * 7,
      y: PET_FRAME_HEIGHT,
      width: PET_FRAME_WIDTH,
      height: PET_FRAME_HEIGHT
    })
  })

  it('resolves rich package clips and falls back to the Codex atlas when an action is missing', () => {
    const richClip = resolvePetRuntimeClip(
      {
        multiAssetClips: {
          wave: {
            frames: [
              {
                durationMs: 180,
                height: 96,
                imageUrl: 'file:///pet/wave-1.webp',
                width: 96
              }
            ],
            loop: false,
            phaseGroup: 'gesture'
          }
        },
        spriteUrl: 'file:///pet/fallback.webp'
      },
      'wave'
    )
    const fallbackClip = resolvePetRuntimeClip(
      {
        multiAssetClips: {},
        spriteUrl: 'file:///pet/fallback.webp'
      },
      'waiting'
    )

    expect(richClip).toEqual({
      frames: [
        {
          height: 96,
          imageUrl: 'file:///pet/wave-1.webp',
          width: 96
        }
      ],
      frameDurations: [180],
      loop: false,
      phaseKey: 'multi-asset:gesture:wave'
    })
    expect(fallbackClip.phaseKey).toBe('codex-atlas:waiting')
    expect(fallbackClip.frames[0]?.imageUrl).toBe('file:///pet/fallback.webp')
  })
})
