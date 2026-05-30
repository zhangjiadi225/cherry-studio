import type { PetRuntimeClip } from '@shared/pet'

const loadedUrls = new Set<string>()

export function preloadPetRuntimeClipAssets(clip: PetRuntimeClip): void {
  if (typeof Image === 'undefined') return

  for (const imageUrl of new Set(clip.frames.map((frame) => frame.imageUrl).filter(Boolean))) {
    if (loadedUrls.has(imageUrl)) continue
    loadedUrls.add(imageUrl)

    const image = new Image()
    image.src = imageUrl
  }
}

export function clearPetAssetCache(): void {
  loadedUrls.clear()
}
