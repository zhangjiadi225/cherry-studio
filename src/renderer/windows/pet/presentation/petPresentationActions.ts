import type { PetTaskBubbleHoldState } from '@shared/pet'

const PET_PRESENTATION_ACTION_EVENT = 'cherry:pet-presentation-action'

export type PetPresentationAction =
  | { type: 'approval.dismissed'; approvalId: string; updatedAt: number }
  | { type: 'task.bubbleHoldChanged'; state: PetTaskBubbleHoldState; updatedAt: number }
  | { type: 'task.dismissed'; taskKey: string; updatedAt: number }
  | { type: 'task.opened'; taskKey: string; updatedAt: number }

export function onPetPresentationAction(callback: (action: PetPresentationAction) => void): () => void {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && isPetPresentationAction(event.detail)) {
      callback(event.detail)
    }
  }
  window.addEventListener(PET_PRESENTATION_ACTION_EVENT, listener)
  return () => window.removeEventListener(PET_PRESENTATION_ACTION_EVENT, listener)
}

export function openPetTask(taskKey: string): Promise<void> {
  emitPetPresentationAction({ type: 'task.opened', taskKey, updatedAt: Date.now() })
  return window.api.pet.openTask(taskKey)
}

export function dismissPetTask(taskKey: string): Promise<void> {
  emitPetPresentationAction({ type: 'task.dismissed', taskKey, updatedAt: Date.now() })
  return window.api.pet.dismissTaskBubble(taskKey)
}

export function dismissPetApproval(approvalId: string): Promise<void> {
  emitPetPresentationAction({ type: 'approval.dismissed', approvalId, updatedAt: Date.now() })
  return window.api.pet.dismissPermissionPrompt(approvalId)
}

export function setPetTaskBubbleHold(state: PetTaskBubbleHoldState): Promise<void> {
  emitPetPresentationAction({ type: 'task.bubbleHoldChanged', state, updatedAt: Date.now() })
  return window.api.pet.setTaskBubbleHold(state)
}

function emitPetPresentationAction(action: PetPresentationAction): void {
  window.dispatchEvent(new CustomEvent(PET_PRESENTATION_ACTION_EVENT, { detail: action }))
}

function isPetPresentationAction(value: unknown): value is PetPresentationAction {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  const type = (value as { type?: unknown }).type
  return (
    type === 'approval.dismissed' ||
    type === 'task.bubbleHoldChanged' ||
    type === 'task.dismissed' ||
    type === 'task.opened'
  )
}
