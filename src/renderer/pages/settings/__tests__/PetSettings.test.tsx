import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPetVrmStageModelProfile } from '../../../windows/pet/vrm/vrmModelLibrary'
import PetSettings from '../PetSettings'

const spriteAnimatorMock = vi.hoisted(() => vi.fn(() => <div data-testid="sprite-animator" />))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { id?: string }) => (options?.id ? `${key}_${options.id}` : key)
    })
  }
})

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/windows/pet/sprite/SpriteAnimator', () => ({
  default: spriteAnimatorMock
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: MockUsePreference.usePreference
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgents: () => ({
    agents: [
      { id: 'agent-a', name: 'Agent A' },
      { id: 'agent-b', name: 'Agent B' }
    ],
    error: null,
    isLoading: false,
    refetch: vi.fn()
  })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Button: ({
    children,
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  RowFlex: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SegmentedControl: <T extends string>({
    onValueChange,
    options,
    value
  }: {
    onValueChange?: (value: T) => void
    options: Array<{ label: string; value: T }>
    value?: T
  }) => (
    <div data-segmented-value={value}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onValueChange?.(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Slider: ({
    max = 100,
    min = 0,
    value,
    onValueChange,
    onValueCommit
  }: {
    max?: number
    min?: number
    value?: number[]
    onValueChange?: (value: number[]) => void
    onValueCommit?: (value: number[]) => void
  }) => (
    <div>
      <div data-testid="slider">{value?.[0]}</div>
      <button type="button" aria-label="slider-change-320" onClick={() => onValueChange?.([320])} />
      <button type="button" aria-label="slider-change-720" onClick={() => onValueChange?.([720])} />
      <button type="button" aria-label="slider-commit-320" onClick={() => onValueCommit?.([320])} />
      <button type="button" aria-label="slider-commit-720" onClick={() => onValueCommit?.([720])} />
      <button type="button" aria-label="slider-commit-min" onClick={() => onValueCommit?.([min])} />
      <button type="button" aria-label="slider-commit-max" onClick={() => onValueCommit?.([max])} />
    </div>
  ),
  Select: ({
    children,
    onValueChange,
    value
  }: React.HTMLAttributes<HTMLDivElement> & { onValueChange?: (value: string) => void; value?: string }) => (
    <div data-select-value={value}>
      {children}
      <button
        type="button"
        aria-label={`select-vroid-greeting-${value}`}
        onClick={() => onValueChange?.('vroid-greeting')}
      />
      <button type="button" aria-label={`select-animal-b-${value}`} onClick={() => onValueChange?.('animal-b')} />
    </div>
  ),
  SelectContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectItem: ({ children, value, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => (
    <button type="button" value={value} {...props}>
      {children}
    </button>
  ),
  SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button aria-checked={checked} role="switch" type="button" onClick={() => onCheckedChange?.(!checked)} />
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children, content }: React.HTMLAttributes<HTMLDivElement> & { content?: React.ReactNode }) => (
    <div data-tooltip={content ? String(content) : undefined}>{children}</div>
  )
}))

describe('PetSettings', () => {
  beforeEach(() => {
    spriteAnimatorMock.mockClear()
    vi.clearAllMocks()
    window.localStorage.clear()
    MockUsePreferenceUtils.resetMocks()
    Object.assign(window, {
      api: {
        ...window.api,
        pet: {
          close: vi.fn(),
          deletePackage: vi.fn(),
          getPastureSnapshot: vi.fn(async () => createSnapshot()),
          onPastureChanged: vi.fn(() => vi.fn()),
          resizePasture: vi.fn(),
          selectAndImportPackage: vi.fn(),
          selectPackage: vi.fn(),
          setPin: vi.fn(),
          show: vi.fn(),
          assets: {
            list: vi.fn(async () => [
              {
                createdAt: 1,
                displayName: 'Model A',
                files: [{ mediaType: 'model/vrm', relativePath: 'model-a.vrm', role: 'model', sizeBytes: 2048 }],
                id: 'model-a',
                kind: 'vrm-model',
                originalFileName: 'Model A.vrm',
                sizeBytes: 2048,
                updatedAt: 1
              }
            ])
          },
          upsertAnimal: vi.fn()
        }
      },
      modal: {
        confirm: vi.fn()
      },
      toast: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('shows the DND setting and disables deleting packages that still have a pet', async () => {
    render(<PetSettings />)

    expect(await screen.findByText('settings.pet.dnd_enabled')).toBeInTheDocument()
    const deleteButton = await screen.findByLabelText('settings.pet.delete')

    expect(deleteButton).toBeDisabled()
    expect(deleteButton.parentElement).toHaveAttribute('data-tooltip', 'settings.pet.delete_in_use')
    expect(spriteAnimatorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clip: expect.objectContaining({
          phaseKey: 'codex-atlas:idle'
        })
      }),
      undefined
    )
  })

  it('exposes personality and agent binding controls from the settings page', async () => {
    render(<PetSettings />)

    expect(await screen.findByText('settings.pet.dnd_enabled')).toBeInTheDocument()

    expect(screen.getAllByText('settings.pet.personality.label')).toHaveLength(1)
    expect(screen.getAllByText('settings.pet.agent_binding')).toHaveLength(1)
    expect(screen.getByText('Agent A')).toBeInTheDocument()
  })

  it('does not refresh source bindings after disabling a pet', async () => {
    render(<PetSettings />)

    await screen.findAllByText('Package A')
    const switches = await screen.findAllByRole('switch')
    await userEvent.click(switches[3])

    expect(window.api.pet.upsertAnimal).toHaveBeenCalled()
  })

  it('scopes VRM stage settings to model management without touching 2D animals', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.mode', 'vrm-stage')
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.vrm.model_profiles', {
      [profile.modelId]: profile
    })

    render(<PetSettings />)

    expect(await screen.findByText('settings.pet.vrm.models')).toBeInTheDocument()
    expect(await screen.findByText('settings.pet.vrm.position_x')).toBeInTheDocument()
    expect(screen.getByText('settings.pet.vrm.position_y')).toBeInTheDocument()
    expect(screen.getByText('settings.pet.vrm.position_z')).toBeInTheDocument()
    expect(screen.getByText('settings.pet.vrm.animation_preset')).toBeInTheDocument()
    expect(screen.getByText('settings.pet.vrm.scene_settings')).toBeInTheDocument()
    expect(screen.getByText('settings.pet.vrm.expression')).toBeInTheDocument()
    expect(screen.getByText('settings.pet.vrm.look_at_cursor')).toBeInTheDocument()
    expect(screen.queryByText('settings.pet.window_width')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.pet.pet_size')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.pet.vrm.presets')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.pet.vrm.preset_source')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.pet.packages')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.pet.personality.label')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.pet.agent_binding')).not.toBeInTheDocument()
    expect(spriteAnimatorMock).not.toHaveBeenCalled()

    expect(window.api.pet.upsertAnimal).not.toHaveBeenCalled()
  })

  it('updates desktop window width and pet size from sliders', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.pasture_bounds', { x: 12, y: 34, width: 640 })
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.scale', 0.42)

    render(<PetSettings />)

    await screen.findByText('settings.pet.window_width')
    const sliders = await screen.findAllByTestId('slider')

    expect(sliders[0]).toHaveTextContent('640')
    expect(sliders[1]).toHaveTextContent('42')

    fireEvent.click(screen.getAllByRole('button', { name: 'slider-change-720' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'slider-commit-720' })[0])

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.pasture_bounds')).toEqual({
        x: 12,
        y: 34,
        width: 720
      })
      expect(window.api.pet.resizePasture).toHaveBeenCalledWith(720)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'slider-change-320' })[1])
    fireEvent.click(screen.getAllByRole('button', { name: 'slider-commit-320' })[1])

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.scale')).toBe(0.64)
    })
  })

  it('updates VRM model and scene 3D controls', async () => {
    const profile = createPetVrmStageModelProfile({
      enabled: true,
      modelId: 'model-a',
      order: 0
    })
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.mode', 'vrm-stage')
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.vrm.model_profiles', {
      [profile.modelId]: profile
    })

    render(<PetSettings />)

    const positionXInput = await screen.findByLabelText('settings.pet.vrm.position_x')
    const positionZInput = await screen.findByLabelText('settings.pet.vrm.position_z')

    fireEvent.change(positionXInput, { target: { value: '1.25' } })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.vrm.model_profiles')).toMatchObject({
        'model-a': {
          positionX: 1.25
        }
      })
    })

    fireEvent.change(positionZInput, { target: { value: '-0.4' } })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.vrm.model_profiles')).toMatchObject({
        'model-a': {
          positionZ: -0.4
        }
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'select-vroid-greeting-vroid-show-full-body' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.vrm.model_profiles')).toMatchObject({
        'model-a': {
          animationPreset: 'vroid-greeting'
        }
      })
    })

    const keyLightControl = await screen.findByRole('group', { name: 'settings.pet.vrm.key_light' })
    fireEvent.click(within(keyLightControl).getByRole('button', { name: 'slider-commit-max' }))

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.vrm.scene_settings')).toMatchObject({
        keyLightIntensity: 6
      })
    })
  })

  it('does not enable a VRM model when editing its 3D controls', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.mode', 'vrm-stage')
    MockUsePreferenceUtils.setPreferenceValue('feature.pet.vrm.model_profiles', {})

    render(<PetSettings />)

    const positionXInput = await screen.findByLabelText('settings.pet.vrm.position_x')

    fireEvent.change(positionXInput, { target: { value: '1.25' } })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.pet.vrm.model_profiles')).toMatchObject({
        'model-a': {
          enabled: false,
          positionX: 1.25
        }
      })
    })
  })
})

function createSnapshot() {
  return {
    animals: [
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        enabled: true,
        agentId: 'agent-a',
        homeXRatio: 0.5,
        id: 'animal-a',
        name: 'Pet A',
        order: 0,
        packageId: 'package-a',
        personality: 'watcher'
      },
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        enabled: true,
        agentId: null,
        homeXRatio: 0.7,
        id: 'animal-b',
        name: 'Pet B',
        order: 1,
        packageId: 'package-a',
        personality: 'scout'
      }
    ],
    bindings: [],
    bounds: { x: -1, y: -1, width: 640 },
    bubbles: [],
    packages: [
      {
        description: 'Package A',
        displayName: 'Package A',
        id: 'package-a',
        manifestVersion: 1,
        name: 'package-a',
        packagePath: 'D:/pets/package-a',
        spriteUrl: 'file:///D:/pets/package-a/sprite.png',
        version: '1.0.0'
      }
    ],
    permissionPrompts: [],
    queuedTasks: []
  }
}
