import { describe, expect, it, vi } from 'vitest'

import { createAgentEventBus } from '../agentEventBus'
import type { AgentEvent } from '../agentEvents'

function event(agentId: string, delta: string): AgentEvent {
  return {
    type: 'message.delta',
    agentId,
    sessionId: 'session-1',
    streamId: 'stream-1',
    timestamp: 1000,
    messageId: 'message-1',
    delta
  }
}

describe('createAgentEventBus', () => {
  it('routes events only to subscribers for the same agent', () => {
    const bus = createAgentEventBus()
    const agentA = vi.fn()
    const agentB = vi.fn()

    bus.subscribe('agent-a', agentA)
    bus.subscribe('agent-b', agentB)

    bus.publish('agent-a', event('agent-a', 'hello'))

    expect(agentA).toHaveBeenCalledWith(event('agent-a', 'hello'))
    expect(agentB).not.toHaveBeenCalled()
  })

  it('stops routing after unsubscribe', () => {
    const bus = createAgentEventBus()
    const handler = vi.fn()
    const unsubscribe = bus.subscribe('agent-a', handler)

    unsubscribe()
    bus.publish('agent-a', event('agent-a', 'ignored'))

    expect(handler).not.toHaveBeenCalled()
  })
})
