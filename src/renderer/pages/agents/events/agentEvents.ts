export type AgentStatus = 'idle' | 'streaming' | 'waiting_approval' | 'tooling' | 'completed' | 'failed' | 'cancelled'

export interface AgentInstance {
  agentId: string
  panelId: string
  currentStreamId?: string
  status: AgentStatus
}

export type { AgentPresentationEvent as AgentEvent } from '@shared/ai/agentPresentationEvents'
