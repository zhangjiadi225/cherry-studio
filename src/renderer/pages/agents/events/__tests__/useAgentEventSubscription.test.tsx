import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createAgentEventBus } from '../agentEventBus'
import type { AgentEvent } from '../agentEvents'
import { useAgentEventSubscription } from '../useAgentEventSubscription'

function event(agentId: string): AgentEvent {
  return {
    type: 'stream.cancelled',
    agentId,
    sessionId: 'session-1',
    streamId: 'stream-1',
    timestamp: 1000
  }
}

describe('useAgentEventSubscription', () => {
  it('subscribes to one agent and cleans up on unmount', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn()

    const { unmount } = renderHook(() => useAgentEventSubscription('agent-1', handler, bus))

    bus.publish('agent-1', event('agent-1'))
    unmount()
    bus.publish('agent-1', event('agent-1'))

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('resubscribes when agent id changes', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn()

    const { rerender } = renderHook(({ agentId }) => useAgentEventSubscription(agentId, handler, bus), {
      initialProps: { agentId: 'agent-1' as string | undefined }
    })

    rerender({ agentId: 'agent-2' })
    bus.publish('agent-1', event('agent-1'))
    bus.publish('agent-2', event('agent-2'))

    expect(handler).toHaveBeenCalledWith(event('agent-2'))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
