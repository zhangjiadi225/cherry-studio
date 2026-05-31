import type { PetWindowResizeEdge } from '@shared/pet'
import { PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS } from '@shared/pet'
import { ChevronUp, Eye, EyeOff, Grip, Moon, Pin, PinOff, RefreshCw, Settings, Sun, X } from 'lucide-react'
import type { PointerEvent, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  PetVrmStageLookAtPoint,
  PetVrmStageModel,
  PetVrmStageModelLoadState,
  PetVrmStageModelProfileMap,
  PetVrmStageSceneSettings
} from './types'
import VrmPastureScene from './VrmPastureScene'

const PET_VRM_EDGE_RESIZE_HANDLE_WIDTH = 5
const PET_VRM_RESIZE_FRAME_INSET = 4
const PET_VRM_RESIZE_FRAME_RADIUS = 14
const PET_VRM_RESIZE_FRAME_CORNER_SIZE = 22
const PET_VRM_RESIZE_FRAME_CORNER_THICKNESS = 3

type VrmStageSceneProps = {
  fadeOnHoverEnabled?: boolean
  hitTestPoint?: PetVrmStageLookAtPoint | null
  modelProfiles: PetVrmStageModelProfileMap
  modelLoadStates?: Map<string, PetVrmStageModelLoadState>
  lookAtPoint?: PetVrmStageLookAtPoint | null
  onFadeOnHoverChange?: (enabled: boolean) => void
  onHitTestTransparencyChange?: (transparent: boolean) => void
  onModelLoadStateChange?: (state: PetVrmStageModelLoadState) => void
  onResizePointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>, edge: PetWindowResizeEdge) => void
  onResizePointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onSceneSettingsChange?: (settings: PetVrmStageSceneSettings) => void
  resizeFrameVisible?: boolean
  sceneSettings?: PetVrmStageSceneSettings
  stageFaded?: boolean
  stageHeight: number
  stageWidth: number
}

export default function VrmStageScene({
  fadeOnHoverEnabled,
  hitTestPoint,
  modelProfiles,
  lookAtPoint,
  modelLoadStates,
  onFadeOnHoverChange,
  onHitTestTransparencyChange,
  onModelLoadStateChange,
  onResizePointerCancel,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onSceneSettingsChange,
  resizeFrameVisible = false,
  sceneSettings = PET_VRM_STAGE_DEFAULT_SCENE_SETTINGS,
  stageFaded = false,
  stageHeight,
  stageWidth
}: VrmStageSceneProps) {
  const models = useMemo(() => buildPetVrmStageModels(modelProfiles), [modelProfiles])

  return (
    <>
      <div
        data-testid="pet-vrm-stage-layer"
        style={{
          height: stageHeight,
          left: 0,
          opacity: stageFaded ? 0 : 1,
          overflow: 'hidden',
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          transition: 'opacity 250ms ease-in-out',
          width: stageWidth,
          zIndex: 0
        }}>
        <VrmPastureScene
          hitTestPoint={hitTestPoint}
          lookAtPoint={lookAtPoint}
          models={models}
          onHitTestTransparencyChange={onHitTestTransparencyChange}
          onModelLoadStateChange={onModelLoadStateChange}
          onSceneSettingsChange={onSceneSettingsChange}
          sceneSettings={sceneSettings}
          stageHeight={stageHeight}
          stageWidth={stageWidth}
        />
      </div>
      <PetVrmResizeHandle
        edge="left"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="right"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="top"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="bottom"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="top-left"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="top-right"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="bottom-left"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeHandle
        edge="bottom-right"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <PetVrmResizeFrame visible={resizeFrameVisible} />
      <PetVrmControlsIsland fadeOnHoverEnabled={fadeOnHoverEnabled} onFadeOnHoverChange={onFadeOnHoverChange} />
      <PetVrmStageStatusLayer modelLoadStates={modelLoadStates} models={models} />
    </>
  )
}

export function buildPetVrmStageModels(profiles: PetVrmStageModelProfileMap): PetVrmStageModel[] {
  return [...profiles.values()]
    .filter((profile) => profile.enabled)
    .sort((left, right) => left.order - right.order || left.modelId.localeCompare(right.modelId))
    .map((profile) => ({
      enabled: profile.enabled,
      id: profile.modelId,
      modelId: profile.modelId,
      order: profile.order,
      positionX: profile.positionX,
      positionY: profile.positionY,
      positionZ: profile.positionZ,
      profile
    }))
}

function PetVrmStageStatusLayer({
  modelLoadStates,
  models
}: {
  modelLoadStates?: Map<string, PetVrmStageModelLoadState>
  models: PetVrmStageModel[]
}) {
  const { t } = useTranslation()
  const states = models
    .map((model) => modelLoadStates?.get(model.modelId))
    .filter((state): state is PetVrmStageModelLoadState => Boolean(state && state.phase !== 'ready'))

  if (!states.length) return null

  return (
    <div
      data-pet-hit-zone="true"
      data-testid="pet-vrm-status"
      style={{
        left: 10,
        maxWidth: 320,
        pointerEvents: 'auto',
        position: 'absolute',
        top: 10,
        zIndex: 310
      }}>
      {states.map((state) => (
        <div
          key={state.modelId}
          className={[
            'mb-1.5 rounded-md border px-2 py-1.5 text-xs leading-[18px] shadow-md backdrop-blur-md',
            state.phase === 'error'
              ? 'border-error-border bg-error-bg text-error-text'
              : 'border-border bg-popover text-popover-foreground'
          ].join(' ')}>
          {state.phase === 'loading'
            ? t('settings.pet.vrm.loading')
            : t('settings.pet.vrm.load_failed_detail', { reason: state.error ?? t('settings.pet.vrm.load_failed') })}
        </div>
      ))}
    </div>
  )
}

function PetVrmControlsIsland({
  fadeOnHoverEnabled,
  onFadeOnHoverChange
}: {
  fadeOnHoverEnabled?: boolean
  onFadeOnHoverChange?: (enabled: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pinned, setPinned] = useState(true)
  const [localFadeOnHover, setLocalFadeOnHover] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const fadeOnHover = fadeOnHoverEnabled ?? localFadeOnHover

  const startDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.button !== undefined) return
    void window.api.pet.startDraggingWindow()
  }, [])

  const togglePinned = useCallback(() => {
    setPinned((current) => {
      const next = !current
      void window.api.pet.setPin(next)
      return next
    })
  }, [])

  const toggleFadeOnHover = useCallback(() => {
    const next = !fadeOnHover
    setLocalFadeOnHover(next)
    onFadeOnHoverChange?.(next)
  }, [fadeOnHover, onFadeOnHoverChange])

  const toggleDark = useCallback(() => {
    setDark((current) => {
      const next = !current
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])

  return (
    <div
      data-pet-hit-zone="true"
      data-testid="pet-vrm-controls-island"
      style={{
        alignItems: 'flex-end',
        bottom: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'auto',
        position: 'fixed',
        right: 8,
        zIndex: 330
      }}>
      {expanded ? (
        <div
          style={{
            background: 'color-mix(in srgb, var(--color-popover) 82%, transparent)',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-lg)',
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(3, 36px)',
            marginBottom: 8,
            padding: 8,
            transition: 'opacity 180ms ease, transform 180ms ease',
            backdropFilter: 'blur(16px)'
          }}>
          <PetVrmControlButton
            label="Open pet settings"
            onClick={() => window.api.windowManager.openSettings('/settings/pet')}>
            <Settings size={20} />
          </PetVrmControlButton>
          <PetVrmControlButton label="Refresh VRM stage" onClick={() => window.location.reload()}>
            <RefreshCw size={20} />
          </PetVrmControlButton>
          <PetVrmControlButton label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleDark}>
            {dark ? <Moon size={20} /> : <Sun size={20} />}
          </PetVrmControlButton>
          <PetVrmControlButton label={pinned ? 'Unpin from top' : 'Pin on top'} onClick={togglePinned}>
            {pinned ? <Pin size={20} /> : <PinOff size={20} />}
          </PetVrmControlButton>
          <PetVrmControlButton
            active={fadeOnHover}
            label={fadeOnHover ? 'Disable fade on hover' : 'Enable fade on hover'}
            onClick={toggleFadeOnHover}>
            {fadeOnHover ? <Eye size={20} /> : <EyeOff size={20} />}
          </PetVrmControlButton>
          <PetVrmControlButton label="Close pet window" onClick={() => window.api.pet.close()}>
            <X size={20} />
          </PetVrmControlButton>
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <PetVrmControlButton
          label={expanded ? 'Collapse controls' : 'Expand controls'}
          onClick={() => setExpanded((value) => !value)}>
          <ChevronUp
            size={20}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 180ms ease'
            }}
          />
        </PetVrmControlButton>
        <PetVrmControlButton label="Drag to move window" onPointerDown={startDrag}>
          <Grip size={20} />
        </PetVrmControlButton>
      </div>
    </div>
  )
}

function PetVrmControlButton({
  active = false,
  children,
  label,
  onClick,
  onPointerDown
}: {
  active?: boolean
  children: ReactNode
  label: string
  onClick?: () => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      aria-label={label}
      title={label}
      type="button"
      style={{
        alignItems: 'center',
        background: active
          ? 'color-mix(in srgb, var(--color-primary) 20%, var(--color-popover))'
          : 'color-mix(in srgb, var(--color-popover) 82%, transparent)',
        border: '2px solid var(--color-border)',
        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
        borderRadius: 12,
        color: active ? 'var(--color-primary)' : 'var(--color-foreground)',
        cursor: 'pointer',
        display: 'flex',
        height: 36,
        justifyContent: 'center',
        padding: 8,
        transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease',
        width: 36,
        backdropFilter: 'blur(12px)'
      }}
      onClick={onClick}
      onPointerDown={onPointerDown}>
      {children}
    </button>
  )
}

function PetVrmResizeHandle({
  edge,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  edge: PetWindowResizeEdge
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>, edge: PetWindowResizeEdge) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
}) {
  const edgeStyle = getPetVrmResizeHandleStyle(edge)

  return (
    <div
      data-pet-hit-zone="true"
      data-testid={`pet-resize-vrm-${edge}`}
      style={{ position: 'absolute', zIndex: 320, ...edgeStyle }}
      onPointerCancel={onPointerCancel}
      onPointerDown={(event) => onPointerDown(event, edge)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

function PetVrmResizeFrame({ visible }: { visible: boolean }) {
  const cornerBase = {
    borderColor: 'var(--color-primary)',
    borderStyle: 'solid',
    borderWidth: 0,
    filter: 'drop-shadow(0 0 5px rgba(0, 0, 0, 0.35))',
    height: PET_VRM_RESIZE_FRAME_CORNER_SIZE,
    position: 'absolute',
    width: PET_VRM_RESIZE_FRAME_CORNER_SIZE
  } as const
  const cornerThickness = PET_VRM_RESIZE_FRAME_CORNER_THICKNESS

  return (
    <div
      aria-hidden
      data-testid="pet-vrm-resize-frame"
      data-visible={visible ? 'true' : 'false'}
      style={{
        inset: PET_VRM_RESIZE_FRAME_INSET,
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        position: 'absolute',
        transition: 'opacity 180ms ease',
        zIndex: 315
      }}>
      <div
        style={{
          border: '2px solid var(--color-primary)',
          borderRadius: PET_VRM_RESIZE_FRAME_RADIUS,
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.45), 0 0 18px rgba(0, 0, 0, 0.3)',
          height: '100%',
          opacity: 0.58,
          width: '100%'
        }}
      />
      <div
        style={{
          ...cornerBase,
          borderLeftWidth: cornerThickness,
          borderTopLeftRadius: 6,
          borderTopWidth: cornerThickness,
          left: 0,
          top: 0
        }}
      />
      <div
        style={{
          ...cornerBase,
          borderRightWidth: cornerThickness,
          borderTopRightRadius: 6,
          borderTopWidth: cornerThickness,
          right: 0,
          top: 0
        }}
      />
      <div
        style={{
          ...cornerBase,
          borderBottomLeftRadius: 6,
          borderBottomWidth: cornerThickness,
          borderLeftWidth: cornerThickness,
          bottom: 0,
          left: 0
        }}
      />
      <div
        style={{
          ...cornerBase,
          borderBottomRightRadius: 6,
          borderBottomWidth: cornerThickness,
          borderRightWidth: cornerThickness,
          bottom: 0,
          right: 0
        }}
      />
    </div>
  )
}

function getPetVrmResizeHandleStyle(edge: PetWindowResizeEdge): Record<string, number | string> {
  const edgeSize = PET_VRM_EDGE_RESIZE_HANDLE_WIDTH
  const cornerSize = edgeSize * 2

  switch (edge) {
    case 'left':
      return { bottom: edgeSize, cursor: 'ew-resize', left: 0, top: edgeSize, width: edgeSize }
    case 'right':
      return { bottom: edgeSize, cursor: 'ew-resize', right: 0, top: edgeSize, width: edgeSize }
    case 'top':
      return { cursor: 'ns-resize', height: edgeSize, left: edgeSize, right: edgeSize, top: 0 }
    case 'bottom':
      return { bottom: 0, cursor: 'ns-resize', height: edgeSize, left: edgeSize, right: edgeSize }
    case 'top-left':
      return { cursor: 'nwse-resize', height: cornerSize, left: 0, top: 0, width: cornerSize }
    case 'bottom-right':
      return { bottom: 0, cursor: 'nwse-resize', height: cornerSize, right: 0, width: cornerSize }
    case 'top-right':
      return { cursor: 'nesw-resize', height: cornerSize, right: 0, top: 0, width: cornerSize }
    case 'bottom-left':
      return { bottom: 0, cursor: 'nesw-resize', height: cornerSize, left: 0, width: cornerSize }
  }
}
