import type { PetTaskBinding, PetTaskBubbleSnapshot } from '@shared/pet'

import type { PastureAnimalPosition } from './PastureAnimal'
import type { PetBehaviorContext, PetBehaviorTaskState } from './petBehavior'
import type { PetSpriteSceneAnimal } from './SpriteTaskLayers'

export function buildPetPastureContexts(input: {
  animals: PetSpriteSceneAnimal[]
  bindingByAnimalId: Map<string, PetTaskBinding>
  bubbleByAnimalId: Map<string, PetTaskBubbleSnapshot>
  livePositions: Map<string, PastureAnimalPosition>
}): Map<string, PetBehaviorContext> {
  const enabledAnimals = input.animals.filter((animal) => animal.enabled)
  const contexts = new Map<string, PetBehaviorContext>()

  for (const animal of enabledAnimals) {
    const position = input.livePositions.get(animal.id) ?? {
      animalId: animal.id,
      mode: 'observing' as const,
      xRatio: animal.homeXRatio
    }
    const binding = input.bindingByAnimalId.get(animal.id)
    const bubble = input.bubbleByAnimalId.get(animal.id)
    const nearbyPets = enabledAnimals
      .filter((candidate) => candidate.id !== animal.id)
      .map((candidate) => {
        const candidatePosition = input.livePositions.get(candidate.id) ?? {
          animalId: candidate.id,
          mode: 'observing' as const,
          xRatio: candidate.homeXRatio
        }
        return {
          animalId: candidate.id,
          distance: Math.abs(candidatePosition.xRatio - position.xRatio),
          mode: candidatePosition.mode,
          xRatio: candidatePosition.xRatio
        }
      })
      .filter((pet) => pet.distance <= 0.12)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3)
      .map((pet) => ({
        animalId: pet.animalId,
        mode: pet.mode,
        xRatio: pet.xRatio
      }))
    const scenePeers = enabledAnimals.filter((candidate) => candidate.id !== animal.id)
    const sceneEnergy = scenePeers.length
      ? scenePeers.reduce((sum, candidate) => {
          const mode = input.livePositions.get(candidate.id)?.mode
          return sum + (mode === 'walking' || mode === 'playing' ? 1 : 0)
        }, 0) / scenePeers.length
      : 0

    contexts.set(animal.id, {
      nearbyPets,
      sceneActivityHint: getSceneActivityHint(sceneEnergy),
      sceneEnergy,
      streaming: getContextStreaming(binding ?? bubble),
      suppressReason: binding ? 'task-bound' : bubble && !bubble.bubbleDismissed ? 'bubble-visible' : undefined,
      task: getContextTaskState(binding?.status ?? bubble?.status),
      userFocus: 'none'
    })
  }

  return contexts
}

function getSceneActivityHint(sceneEnergy: number): PetBehaviorContext['sceneActivityHint'] {
  if (sceneEnergy >= 0.5) return 'quiet'
  if (sceneEnergy >= 0.25) return 'normal'
  return 'active'
}

function getContextStreaming(
  task: PetTaskBinding | PetTaskBubbleSnapshot | undefined
): PetBehaviorContext['streaming'] {
  if (!task?.streamText) return 'idle'
  return task.status === 'done' || task.status === 'failed' || task.status === 'aborted' ? 'complete' : 'streaming'
}

function getContextTaskState(
  status: PetTaskBinding['status'] | PetTaskBubbleSnapshot['status'] | undefined
): PetBehaviorTaskState {
  switch (status) {
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'review':
      return 'review'
    case 'done':
      return 'success'
    case 'failed':
      return 'error'
    case 'aborted':
      return 'aborted'
    case undefined:
      return 'idle'
  }
}
