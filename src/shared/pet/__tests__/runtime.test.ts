import { PET_ANIMATIONS, PET_FRAME_HEIGHT, PET_FRAME_WIDTH, resolvePetRuntimeClip } from '@shared/pet'
import { describe, expect, it } from 'vitest'

describe('pet runtime clips', () => {
  it('reuses resolved clips for the same package action without merging semantic phases', () => {
    const petPackage = {
      spriteUrl: 'file:///pet/spritesheet.webp'
    }

    const firstIdle = resolvePetRuntimeClip(petPackage, 'idle')
    const secondIdle = resolvePetRuntimeClip(petPackage, 'idle')
    const sleep = resolvePetRuntimeClip(petPackage, 'sleep')
    const observe = resolvePetRuntimeClip(petPackage, 'observe')

    expect(secondIdle).toBe(firstIdle)
    expect(secondIdle.frames).toBe(firstIdle.frames)
    expect(sleep.phaseKey).toBe('codex-atlas:sleep')
    expect(observe.phaseKey).toBe('codex-atlas:observe')
    expect(sleep.phaseKey).not.toBe(firstIdle.phaseKey)
    expect(observe.phaseKey).not.toBe(firstIdle.phaseKey)
    expect(sleep.frames).toEqual(firstIdle.frames)
    expect(observe.frames).toEqual(firstIdle.frames)
  })

  it('reuses valid multi-asset clips for the same package action', () => {
    const petPackage = {
      multiAssetClips: {
        wave: {
          frames: [{ durationMs: 180, height: 96, imageUrl: 'file:///pet/wave-1.webp', width: 96 }],
          loop: false,
          phaseGroup: 'gesture'
        }
      },
      spriteUrl: 'file:///pet/fallback.webp'
    }

    const firstWave = resolvePetRuntimeClip(petPackage, 'wave')
    const secondWave = resolvePetRuntimeClip(petPackage, 'wave')

    expect(secondWave).toBe(firstWave)
    expect(secondWave.frames).toBe(firstWave.frames)
    expect(secondWave.frameDurations).toBe(firstWave.frameDurations)
    expect(firstWave.phaseKey).toBe('multi-asset:gesture:wave')
  })

  it('falls back to the atlas when a multi-asset clip has no usable frames', () => {
    const emptyFramesClip = resolvePetRuntimeClip(
      {
        multiAssetClips: {
          wave: {
            frames: [],
            loop: false
          }
        },
        spriteUrl: 'file:///pet/fallback.webp'
      },
      'wave'
    )

    expect(emptyFramesClip).toMatchObject({
      frameDurations: PET_ANIMATIONS.waving.frameDurations,
      loop: false,
      phaseKey: 'codex-atlas:wave'
    })
    expect(emptyFramesClip.frames).toHaveLength(PET_ANIMATIONS.waving.frameCount)
    expect(emptyFramesClip.frames[0]).toEqual({
      imageUrl: 'file:///pet/fallback.webp',
      x: 0,
      y: PET_FRAME_HEIGHT * PET_ANIMATIONS.waving.row,
      width: PET_FRAME_WIDTH,
      height: PET_FRAME_HEIGHT
    })
  })

  it('falls back to the atlas when multi-asset timing or loop metadata is invalid', () => {
    const invalidDurationClip = resolvePetRuntimeClip(
      {
        multiAssetClips: {
          wave: {
            frames: [{ durationMs: 0, height: 96, imageUrl: 'file:///pet/wave-1.webp', width: 96 }],
            loop: false
          }
        },
        spriteUrl: 'file:///pet/fallback.webp'
      },
      'wave'
    )
    const invalidLoopClip = resolvePetRuntimeClip(
      {
        multiAssetClips: {
          run: {
            frames: [{ durationMs: 120, height: 96, imageUrl: 'file:///pet/run-1.webp', width: 96 }],
            loop: undefined
          }
        },
        spriteUrl: 'file:///pet/fallback.webp'
      } as unknown as Parameters<typeof resolvePetRuntimeClip>[0],
      'run'
    )

    expect(invalidDurationClip.phaseKey).toBe('codex-atlas:wave')
    expect(invalidDurationClip.frameDurations).toEqual(PET_ANIMATIONS.waving.frameDurations)
    expect(invalidLoopClip.phaseKey).toBe('codex-atlas:run')
    expect(invalidLoopClip.frameDurations).toEqual(PET_ANIMATIONS.running.frameDurations)
  })
})
