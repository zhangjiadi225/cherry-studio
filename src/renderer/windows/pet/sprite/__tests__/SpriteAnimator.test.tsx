import type { PetRuntimeClip } from '@shared/pet'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpriteAnimator from '../SpriteAnimator'

describe('SpriteAnimator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps frame progress when the same phase is rerendered with a new clip object', () => {
    const { container, rerender } = render(<SpriteAnimator clip={createClip()} />)

    act(() => {
      vi.advanceTimersByTime(90)
    })
    rerender(<SpriteAnimator clip={createClip()} />)
    act(() => {
      vi.advanceTimersByTime(10)
    })

    expect(getSprite(container).style.backgroundPosition).toBe('-10px 0px')
  })

  it('finishes playOnce clips once on schedule when the same phase rerenders near the end', () => {
    const onAnimationEnd = vi.fn()
    const { rerender } = render(
      <SpriteAnimator clip={createClip({ loop: false })} onAnimationEnd={onAnimationEnd} playOnce />
    )

    act(() => {
      vi.advanceTimersByTime(150)
    })
    rerender(<SpriteAnimator clip={createClip({ loop: false })} onAnimationEnd={onAnimationEnd} playOnce />)
    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(onAnimationEnd).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onAnimationEnd).toHaveBeenCalledTimes(1)
  })

  it('renders a stable fallback frame for empty clips', () => {
    const { container } = render(<SpriteAnimator clip={createClip({ frameCount: 0 })} />)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    const sprite = getSprite(container)
    expect(sprite.style.backgroundImage).toBe('url("")')
    expect(sprite.style.backgroundPosition).toBe('0px 0px')
    expect(vi.getTimerCount()).toBe(0)
  })
})

function createClip({
  frameCount = 2,
  loop = true,
  phaseKey = 'shared-package:idle'
}: {
  frameCount?: number
  loop?: boolean
  phaseKey?: string
} = {}): PetRuntimeClip {
  return {
    frameDurations: Array.from({ length: frameCount }, () => 100),
    frames: Array.from({ length: frameCount }, (_, index) => ({
      height: 20,
      imageUrl: `file:///frame-${index}.png`,
      width: 20,
      x: index * 10,
      y: 0
    })),
    loop,
    phaseKey
  }
}

function getSprite(container: HTMLElement): HTMLElement {
  const sprite = container.querySelector('[aria-hidden="true"]')
  if (!(sprite instanceof HTMLElement)) throw new Error('Sprite element not found')
  return sprite
}
