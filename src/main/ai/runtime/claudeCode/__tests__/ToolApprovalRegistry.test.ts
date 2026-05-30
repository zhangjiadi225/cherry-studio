import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

const { toolApprovalRegistry } = await import('../ToolApprovalRegistry')

describe('ToolApprovalRegistry pending snapshots', () => {
  beforeEach(() => {
    toolApprovalRegistry.clear('test-reset')
  })

  it('emits bounded redacted previews for pending approvals', () => {
    const listener = vi.fn()
    const dispose = toolApprovalRegistry.onPendingChanged(listener)

    toolApprovalRegistry.register({
      approvalId: 'approval-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      originalInput: {
        command: 'curl https://api.example.test -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret"',
        api_key: 'sk-proj-abcdefghijklmnopqrstuvwxyz'
      },
      resolve: vi.fn()
    })

    expect(listener).toHaveBeenLastCalledWith(1, [
      expect.objectContaining({
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        safePreview: expect.stringContaining('[REDACTED]')
      })
    ])
    const snapshot = listener.mock.calls.at(-1)?.[1][0]
    expect(snapshot.safePreview).not.toContain('sk-proj-')
    expect(snapshot.safePreview).not.toContain('eyJhbGciOiJ')
    expect(snapshot.safePreview.length).toBeLessThanOrEqual(500)

    dispose()
  })

  it('does not expose raw approval input in snapshots', () => {
    const listener = vi.fn()
    const dispose = toolApprovalRegistry.onPendingChanged(listener)

    toolApprovalRegistry.register({
      approvalId: 'approval-2',
      sessionId: 'session-1',
      toolCallId: 'tool-2',
      toolName: 'Write',
      originalInput: {
        file_path: 'D:/repo/.env',
        content: 'DATABASE_URL=postgres://user:password@example.test/db'
      },
      resolve: vi.fn()
    })

    const snapshot = listener.mock.calls.at(-1)?.[1][0]
    expect(snapshot).not.toHaveProperty('originalInput')
    expect(snapshot).not.toHaveProperty('input')
    expect(JSON.stringify(snapshot)).not.toContain('postgres://user:password')

    dispose()
  })
})
