import { PET_DEFAULT_SCALE, PET_FRAME_HEIGHT, PET_FRAME_WIDTH, type PetRuntimeClip } from '@shared/pet'
import type { CSSProperties, FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

type SpriteAnimatorProps = {
  className?: string
  clip: PetRuntimeClip
  onAnimationEnd?: () => void
  playOnce?: boolean
  scale?: number
}

const SpriteAnimator: FC<SpriteAnimatorProps> = ({
  className,
  clip,
  onAnimationEnd,
  playOnce = false,
  scale = PET_DEFAULT_SCALE
}) => {
  const [frameIndex, setFrameIndex] = useState(0)
  const clipRef = useRef(clip)
  const onAnimationEndRef = useRef(onAnimationEnd)
  const frame = useMemo(() => clip.frames[frameIndex] ?? clip.frames[0], [clip.frames, frameIndex])
  const animationIdentity = clip.phaseKey ?? clip

  clipRef.current = clip

  useEffect(() => {
    onAnimationEndRef.current = onAnimationEnd
  }, [onAnimationEnd])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let ended = false
    let currentFrame = 0

    const setCurrentFrame = (nextFrame: number) => {
      currentFrame = nextFrame
      setFrameIndex(nextFrame)
    }

    const getCurrentFrameDuration = () => {
      const currentClip = clipRef.current
      return (
        currentClip.frameDurations[currentFrame] ??
        currentClip.frameDurations[currentClip.frameDurations.length - 1] ??
        120
      )
    }

    const scheduleNextFrame = () => {
      timeout = setTimeout(() => {
        if (cancelled) return

        const currentClip = clipRef.current
        const nextFrame = currentFrame + 1
        if (nextFrame >= currentClip.frames.length) {
          if (currentClip.loop && !playOnce) {
            setCurrentFrame(0)
            scheduleNextFrame()
            return
          }

          if (ended) return
          ended = true
          onAnimationEndRef.current?.()
          return
        }

        setCurrentFrame(nextFrame)
        scheduleNextFrame()
      }, getCurrentFrameDuration())
    }

    if (clipRef.current.frames.length === 0) {
      setCurrentFrame(0)
      return () => {
        cancelled = true
      }
    }

    setCurrentFrame(currentFrame)
    scheduleNextFrame()

    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [animationIdentity, clip.frames.length, clip.loop, playOnce])

  const wrapperStyle: CSSProperties = {
    width: (frame?.width ?? PET_FRAME_WIDTH) * scale,
    height: (frame?.height ?? PET_FRAME_HEIGHT) * scale
  }

  const spriteStyle: CSSProperties = {
    width: frame?.width ?? PET_FRAME_WIDTH,
    height: frame?.height ?? PET_FRAME_HEIGHT,
    backgroundImage: `url("${frame?.imageUrl ?? ''}")`,
    backgroundPosition: `-${frame?.x ?? 0}px -${frame?.y ?? 0}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    transform: `scale(${scale})`,
    transformOrigin: 'top left'
  }

  return (
    <div className={className} style={wrapperStyle}>
      <div aria-hidden style={spriteStyle} />
    </div>
  )
}

export default SpriteAnimator
