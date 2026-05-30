import type { PetRuntimeClip } from '@shared/pet'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPetAssetCache, preloadPetRuntimeClipAssets } from '../petAssetCache'

describe('petAssetCache', () => {
  beforeEach(() => {
    clearPetAssetCache()
  })

  it('preloads each unique image URL in a runtime clip once', () => {
    const images: Array<{ onload?: () => void; src?: string }> = []
    const imageMock = vi.fn(() => {
      const image: { onload?: () => void; src?: string } = {}
      images.push(image)
      return image
    })
    vi.stubGlobal('Image', imageMock)
    const clip: PetRuntimeClip = {
      frames: [
        { height: 96, imageUrl: 'file:///pet/a.webp', width: 96 },
        { height: 96, imageUrl: 'file:///pet/a.webp', width: 96 },
        { height: 96, imageUrl: 'file:///pet/b.webp', width: 96 }
      ],
      frameDurations: [120, 120, 120],
      loop: true
    }

    preloadPetRuntimeClipAssets(clip)
    preloadPetRuntimeClipAssets(clip)

    expect(imageMock).toHaveBeenCalledTimes(2)
    expect(images.map((image) => image.src)).toEqual(['file:///pet/a.webp', 'file:///pet/b.webp'])
  })
})
