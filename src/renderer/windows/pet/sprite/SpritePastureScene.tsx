import type { PetPackageInfo, PetTaskBinding, PetTaskBubbleSnapshot, PetWindowResizeEdge } from '@shared/pet'
import { PET_PASTURE_HEIGHT, PET_PASTURE_MAX_WIDTH } from '@shared/pet'
import type { PointerEvent } from 'react'

import PastureAnimal, { type PastureAnimalPosition } from './PastureAnimal'
import type { PetBehaviorContext } from './petBehavior'
import type { PetOverlayItem, PetSpriteSceneAnimal } from './SpriteTaskLayers'

const PET_PASTURE_BACKGROUND_URL = new URL(
  '../../../assets/images/pet/pasture-demon-slayer-inspired.png',
  import.meta.url
).href
const PET_EDGE_RESIZE_HANDLE_WIDTH = 10

type SpritePastureSceneProps = {
  animals: PetSpriteSceneAnimal[]
  behaviorContextByAnimalId: Map<string, PetBehaviorContext>
  bindingByAnimalId: Map<string, PetTaskBinding>
  bubbleByAnimalId: Map<string, PetTaskBubbleSnapshot>
  backgroundOffsetX: number
  onAnimalPositionChange: (position: PastureAnimalPosition) => void
  onResizePointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>, edge: PetWindowResizeEdge) => void
  onResizePointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerUp: (event: PointerEvent<HTMLDivElement>) => void
  overlayItems: PetOverlayItem[]
  packageById: Map<string, PetPackageInfo>
  petScale: number
  selectedTaskKey: string | null
  stageWidth: number
}

export default function SpritePastureScene({
  animals,
  backgroundOffsetX,
  behaviorContextByAnimalId,
  bindingByAnimalId,
  bubbleByAnimalId,
  onAnimalPositionChange,
  onResizePointerCancel,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  overlayItems,
  packageById,
  petScale,
  selectedTaskKey,
  stageWidth
}: SpritePastureSceneProps) {
  return (
    <>
      <div
        aria-hidden
        data-testid="pet-pasture-background"
        style={{
          backgroundImage: `url("${PET_PASTURE_BACKGROUND_URL}")`,
          backgroundPosition: `${-backgroundOffsetX}px bottom`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${PET_PASTURE_MAX_WIDTH}px ${PET_PASTURE_HEIGHT}px`,
          bottom: 0,
          height: PET_PASTURE_HEIGHT,
          left: 0,
          pointerEvents: 'none',
          position: 'absolute',
          right: 0,
          zIndex: 0
        }}
      />
      <SpriteResizeHandle
        edge="left"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <SpriteResizeHandle
        edge="right"
        onPointerCancel={onResizePointerCancel}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      {animals.map((animal) => {
        const packageInfo = packageById.get(animal.packageId)
        if (!packageInfo) return null
        return (
          <PastureAnimal
            key={animal.id}
            animal={animal}
            behaviorContext={behaviorContextByAnimalId.get(animal.id)}
            bubble={bubbleByAnimalId.get(animal.id)}
            binding={bindingByAnimalId.get(animal.id)}
            hasTaskOverlay={overlayItems.some((item) => item.animalId === animal.id)}
            isTaskFocused={overlayItems.some((item) => item.animalId === animal.id && selectedTaskKey === item.taskKey)}
            onPositionChange={onAnimalPositionChange}
            packageInfo={packageInfo}
            petScale={petScale}
            stageWidth={stageWidth}
          />
        )
      })}
    </>
  )
}

function SpriteResizeHandle({
  edge,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  edge: Extract<PetWindowResizeEdge, 'left' | 'right'>
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>, edge: PetWindowResizeEdge) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      data-pet-hit-zone="true"
      data-testid={`pet-resize-${edge}`}
      style={{
        position: 'absolute',
        [edge]: 0,
        top: 0,
        bottom: 0,
        width: PET_EDGE_RESIZE_HANDLE_WIDTH,
        cursor: 'ew-resize',
        zIndex: 320
      }}
      onPointerCancel={onPointerCancel}
      onPointerDown={(event) => onPointerDown(event, edge)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
