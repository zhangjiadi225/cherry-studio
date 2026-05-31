import type { AgentPresentationEvent } from '@shared/ai/agentPresentationEvents'
import { PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS, type PetPastureSnapshot } from '@shared/pet'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { usePetPresentationRuntime } from '../usePetPresentationRuntime'

describe('usePetPresentationRuntime', () => {
  it('hydrates from pasture snapshot plus generic agent presentation replay and live events', async () => {
    const offAgentPresentation = vi.fn()
    const offPastureChanged = vi.fn()
    let agentPresentationCallback: ((event: AgentPresentationEvent) => void) | undefined
    let pastureChangedCallback: ((snapshot: PetPastureSnapshot) => void) | undefined
    const snapshot = createSnapshot()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          agentPresentation: {
            getReplay: vi
              .fn()
              .mockResolvedValue([
                createAgentEvent('stream.started'),
                createAgentEvent('message.delta', { delta: 'hello' })
              ]),
            onEvent: vi.fn((callback: (event: AgentPresentationEvent) => void) => {
              agentPresentationCallback = callback
              return offAgentPresentation
            })
          }
        },
        pet: {
          getPastureSnapshot: vi.fn().mockResolvedValue(snapshot),
          onPastureChanged: vi.fn((callback: (snapshot: PetPastureSnapshot) => void) => {
            pastureChangedCallback = callback
            return offPastureChanged
          })
        }
      }
    })

    const { unmount } = render(createElement(RuntimeProbe))

    await waitFor(() => {
      expect(screen.getByTestId('pet-runtime-state')).toHaveTextContent('active:hello')
    })

    act(() => {
      agentPresentationCallback?.(createAgentEvent('message.completed', { text: 'hello world' }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('pet-runtime-state')).toHaveTextContent('bubble:hello world')
    })

    act(() => {
      pastureChangedCallback?.({ ...snapshot, bounds: { x: 10, y: 20, width: 720 } })
    })

    await waitFor(() => {
      expect(screen.getByTestId('pet-runtime-state')).toHaveTextContent('bubble:hello world')
    })

    unmount()

    expect(offAgentPresentation).toHaveBeenCalledTimes(1)
    expect(offPastureChanged).toHaveBeenCalledTimes(1)
  })
})

function RuntimeProbe() {
  const { snapshot } = usePetPresentationRuntime()
  const activeText = snapshot.bindings[0]?.streamText
  const bubbleText = snapshot.bubbles[0]?.streamText
  return createElement(
    'div',
    { 'data-testid': 'pet-runtime-state' },
    activeText ? `active:${activeText}` : `bubble:${bubbleText}`
  )
}

function createSnapshot(): PetPastureSnapshot {
  return {
    animals: [
      {
        agentId: 'agent-a',
        createdAt: '2026-01-01T00:00:00.000Z',
        enabled: true,
        homeXRatio: 0.5,
        id: 'animal-a',
        name: 'Animal A',
        order: 0,
        packageId: 'test-pet',
        personality: 'watcher'
      }
    ],
    bindings: [],
    bubbles: [],
    bounds: { x: -1, y: -1, width: 640 },
    packages: [],
    permissionPrompts: [],
    queuedTasks: [],
    vrmModelProfiles: {},
    vrmSceneSettings: { ...PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS }
  }
}

function createAgentEvent<TType extends AgentPresentationEvent['type']>(
  type: TType,
  overrides: Partial<Extract<AgentPresentationEvent, { type: TType }>> = {}
): Extract<AgentPresentationEvent, { type: TType }> {
  return {
    agentId: 'agent-a',
    sessionId: 'session-a',
    streamId: 'turn-a',
    timestamp: 1700000000000,
    type,
    ...overrides
  } as Extract<AgentPresentationEvent, { type: TType }>
}
