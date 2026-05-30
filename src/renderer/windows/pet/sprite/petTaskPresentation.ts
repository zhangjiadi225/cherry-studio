import type { PetTaskStatus } from '@shared/pet'

export type PetTaskBubbleTone = 'neutral' | 'info' | 'warning' | 'success' | 'error'

export type PetTaskBubblePresentation = {
  actionKey: string
  descriptionKey: string
  quickReplyEnabled: boolean
  statusKey: string
  tone: PetTaskBubbleTone
}

const presentations = {
  running: {
    actionKey: 'settings.pet.bubble.open',
    descriptionKey: 'settings.pet.bubble.details.running',
    quickReplyEnabled: true,
    statusKey: 'settings.pet.bubble.status.running',
    tone: 'info'
  },
  waiting: {
    actionKey: 'settings.pet.bubble.review',
    descriptionKey: 'settings.pet.bubble.details.waiting',
    quickReplyEnabled: false,
    statusKey: 'settings.pet.bubble.status.waiting',
    tone: 'warning'
  },
  review: {
    actionKey: 'settings.pet.bubble.open',
    descriptionKey: 'settings.pet.bubble.details.review',
    quickReplyEnabled: false,
    statusKey: 'settings.pet.bubble.status.review',
    tone: 'info'
  },
  done: {
    actionKey: 'settings.pet.bubble.open',
    descriptionKey: 'settings.pet.bubble.details.done',
    quickReplyEnabled: false,
    statusKey: 'settings.pet.bubble.status.done',
    tone: 'success'
  },
  failed: {
    actionKey: 'settings.pet.bubble.open',
    descriptionKey: 'settings.pet.bubble.details.failed',
    quickReplyEnabled: false,
    statusKey: 'settings.pet.bubble.status.failed',
    tone: 'error'
  },
  aborted: {
    actionKey: 'settings.pet.bubble.open',
    descriptionKey: 'settings.pet.bubble.details.aborted',
    quickReplyEnabled: false,
    statusKey: 'settings.pet.bubble.status.aborted',
    tone: 'neutral'
  }
} satisfies Record<PetTaskStatus, PetTaskBubblePresentation>

export function getPetTaskBubblePresentation(status: PetTaskStatus): PetTaskBubblePresentation {
  return presentations[status]
}
