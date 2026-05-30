import { describe, expect, it } from 'vitest'

import { getPetTaskBubblePresentation } from '../petTaskPresentation'

describe('getPetTaskBubblePresentation', () => {
  it('routes approval waits to the review action without quick replies', () => {
    expect(getPetTaskBubblePresentation('waiting')).toMatchObject({
      actionKey: 'settings.pet.bubble.review',
      quickReplyEnabled: false,
      statusKey: 'settings.pet.bubble.status.waiting',
      tone: 'warning'
    })
  })

  it('keeps terminal task bubbles read-only so hover state does not keep them held', () => {
    expect(getPetTaskBubblePresentation('done')).toMatchObject({
      actionKey: 'settings.pet.bubble.open',
      quickReplyEnabled: false,
      statusKey: 'settings.pet.bubble.status.done',
      tone: 'success'
    })
    expect(getPetTaskBubblePresentation('failed')).toMatchObject({
      actionKey: 'settings.pet.bubble.open',
      quickReplyEnabled: false,
      statusKey: 'settings.pet.bubble.status.failed',
      tone: 'error'
    })
    expect(getPetTaskBubblePresentation('aborted')).toMatchObject({
      actionKey: 'settings.pet.bubble.open',
      quickReplyEnabled: false,
      statusKey: 'settings.pet.bubble.status.aborted',
      tone: 'neutral'
    })
  })
})
