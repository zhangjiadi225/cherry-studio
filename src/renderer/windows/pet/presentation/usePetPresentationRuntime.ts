import type { PetPastureSnapshot } from '@shared/pet'
import { useEffect, useState } from 'react'

import { onPetPresentationAction } from './petPresentationActions'
import {
  createPetPresentationRuntimeState,
  type PetPresentationRuntimeState,
  updatePetPresentationRuntimeState,
  updatePetPresentationRuntimeStateFromAction,
  updatePetPresentationRuntimeStateFromAgentEvent
} from './petPresentationRuntime'

export function usePetPresentationRuntime(): PetPresentationRuntimeState {
  const [runtimeState, setRuntimeState] = useState(() => createPetPresentationRuntimeState())

  useEffect(() => {
    let cancelled = false
    let replayReady = false
    const pendingAgentEvents: Parameters<typeof updatePetPresentationRuntimeStateFromAgentEvent>[1][] = []
    const seenAgentEvents = new Set<string>()

    const applyAgentEvent = (event: Parameters<typeof updatePetPresentationRuntimeStateFromAgentEvent>[1]) => {
      const key = getAgentPresentationEventKey(event)
      if (seenAgentEvents.has(key)) return
      seenAgentEvents.add(key)

      if (!replayReady) {
        pendingAgentEvents.push(event)
        return
      }

      setRuntimeState((current) => updatePetPresentationRuntimeStateFromAgentEvent(current, event))
    }

    const offAgentPresentationEvent =
      window.api.ai.agentPresentation?.onEvent((event) => {
        if (!cancelled) applyAgentEvent(event)
      }) ?? (() => {})
    const offPetPresentationAction = onPetPresentationAction((action) => {
      setRuntimeState((current) => updatePetPresentationRuntimeStateFromAction(current, action))
    })

    void Promise.all([window.api.pet.getPastureSnapshot(), window.api.ai.agentPresentation?.getReplay?.() ?? []]).then(
      ([snapshot, replayEvents]) => {
        if (cancelled) return
        setRuntimeState((current) => {
          let next = updatePetPresentationRuntimeState(current, toPetPresentationBaseSnapshot(snapshot))
          for (const event of replayEvents) {
            const key = getAgentPresentationEventKey(event)
            if (seenAgentEvents.has(key)) continue
            seenAgentEvents.add(key)
            next = updatePetPresentationRuntimeStateFromAgentEvent(next, event)
          }
          replayReady = true
          for (const event of pendingAgentEvents.splice(0)) {
            next = updatePetPresentationRuntimeStateFromAgentEvent(next, event)
          }
          return next
        })
      }
    )

    const offPastureChanged = window.api.pet.onPastureChanged((snapshot) => {
      setRuntimeState((current) =>
        updatePetPresentationRuntimeState(current, mergePetPresentationBaseSnapshot(current.snapshot, snapshot))
      )
    })

    return () => {
      cancelled = true
      offAgentPresentationEvent()
      offPetPresentationAction()
      offPastureChanged()
    }
  }, [])

  return runtimeState
}

function toPetPresentationBaseSnapshot(snapshot: PetPastureSnapshot): PetPastureSnapshot {
  return {
    ...snapshot,
    bindings: [],
    bubbles: [],
    permissionPrompts: [],
    queuedTasks: []
  }
}

function mergePetPresentationBaseSnapshot(
  current: PetPastureSnapshot,
  snapshot: PetPastureSnapshot
): PetPastureSnapshot {
  const enabledAnimalIds = new Set(snapshot.animals.filter((animal) => animal.enabled).map((animal) => animal.id))
  const enabledVrmModelIds = new Set(
    Object.values(snapshot.vrmModelProfiles)
      .filter((profile) => profile.enabled)
      .map((profile) => profile.modelId)
  )
  const isTargetEnabled = (task: { animalId: string; petTargetId?: string; petTargetKind?: string }) => {
    const targetId = task.petTargetId || task.animalId
    return task.petTargetKind === 'vrm-model' ? enabledVrmModelIds.has(targetId) : enabledAnimalIds.has(targetId)
  }

  return {
    ...current,
    animals: snapshot.animals,
    bindings: current.bindings.filter(isTargetEnabled),
    bubbles: current.bubbles.filter(isTargetEnabled),
    bounds: snapshot.bounds,
    packages: snapshot.packages,
    permissionPrompts: current.permissionPrompts.filter(isTargetEnabled),
    queuedTasks: current.queuedTasks.filter((task) => !task.animalId || isTargetEnabled(task)),
    vrmModelProfiles: snapshot.vrmModelProfiles,
    vrmSceneSettings: snapshot.vrmSceneSettings
  }
}

function getAgentPresentationEventKey(
  event: Parameters<typeof updatePetPresentationRuntimeStateFromAgentEvent>[1]
): string {
  return JSON.stringify(event)
}
