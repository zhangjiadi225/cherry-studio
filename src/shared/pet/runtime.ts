import { getPetPackageAnimation, PET_FRAME_HEIGHT, PET_FRAME_WIDTH, type PetSemanticAnimationName } from './atlas'
import type { PetMultiAssetClip, PetPackageInfo, PetRuntimeClip } from './types'

type RuntimeClipPackage = Pick<PetPackageInfo, 'animations' | 'multiAssetClips' | 'spriteUrl'>
type CachedRuntimeClip = {
  clip: PetRuntimeClip
  signature: string
}

const runtimeClipCache = new WeakMap<RuntimeClipPackage, Partial<Record<PetSemanticAnimationName, CachedRuntimeClip>>>()

export function resolvePetRuntimeClip(
  petPackage: RuntimeClipPackage,
  animation: PetSemanticAnimationName
): PetRuntimeClip {
  const richClip = petPackage.multiAssetClips?.[animation]
  if (isValidMultiAssetClip(richClip)) {
    const signature = getMultiAssetClipSignature(animation, richClip)
    const cachedClip = getCachedRuntimeClip(petPackage, animation, signature)
    if (cachedClip) return cachedClip

    return setCachedRuntimeClip(petPackage, animation, signature, {
      frames: richClip.frames.map((frame) => ({
        height: frame.height,
        imageUrl: frame.imageUrl,
        width: frame.width
      })),
      frameDurations: richClip.frames.map((frame) => frame.durationMs),
      loop: richClip.loop,
      phaseKey: `multi-asset:${richClip.phaseGroup ?? animation}:${animation}`
    })
  }

  const definition = getPetPackageAnimation(petPackage, animation)
  const signature = `codex-atlas:${petPackage.spriteUrl}:${definition.row}:${definition.frameCount}:${definition.frameDurations.join(',')}:${definition.loop}`
  const cachedClip = getCachedRuntimeClip(petPackage, animation, signature)
  if (cachedClip) return cachedClip

  return setCachedRuntimeClip(petPackage, animation, signature, {
    frames: Array.from({ length: definition.frameCount }, (_, frameIndex) => ({
      imageUrl: petPackage.spriteUrl,
      x: frameIndex * PET_FRAME_WIDTH,
      y: definition.row * PET_FRAME_HEIGHT,
      width: PET_FRAME_WIDTH,
      height: PET_FRAME_HEIGHT
    })),
    frameDurations: definition.frameDurations,
    loop: definition.loop,
    phaseKey: `codex-atlas:${animation}`
  })
}

function getCachedRuntimeClip(
  petPackage: RuntimeClipPackage,
  animation: PetSemanticAnimationName,
  signature: string
): PetRuntimeClip | undefined {
  const cachedClip = runtimeClipCache.get(petPackage)?.[animation]
  return cachedClip?.signature === signature ? cachedClip.clip : undefined
}

function setCachedRuntimeClip(
  petPackage: RuntimeClipPackage,
  animation: PetSemanticAnimationName,
  signature: string,
  clip: PetRuntimeClip
): PetRuntimeClip {
  const packageCache = runtimeClipCache.get(petPackage) ?? {}
  packageCache[animation] = { clip, signature }
  runtimeClipCache.set(petPackage, packageCache)
  return clip
}

function getMultiAssetClipSignature(animation: PetSemanticAnimationName, clip: PetMultiAssetClip): string {
  return [
    'multi-asset',
    animation,
    clip.phaseGroup ?? '',
    clip.loop,
    ...clip.frames.map((frame) => [frame.imageUrl, frame.width, frame.height, frame.durationMs].join(':'))
  ].join('|')
}

function isValidMultiAssetClip(clip: PetMultiAssetClip | undefined): clip is PetMultiAssetClip {
  return Boolean(
    clip &&
      typeof clip.loop === 'boolean' &&
      Array.isArray(clip.frames) &&
      clip.frames.length > 0 &&
      clip.frames.every((frame) => {
        return (
          typeof frame.imageUrl === 'string' &&
          frame.imageUrl.length > 0 &&
          Number.isFinite(frame.width) &&
          frame.width > 0 &&
          Number.isFinite(frame.height) &&
          frame.height > 0 &&
          Number.isFinite(frame.durationMs) &&
          frame.durationMs > 0
        )
      })
  )
}
