import { describe, expect, it } from 'vitest'

import {
  createInitialPetBehaviorState,
  createPetBehaviorPersonality,
  type PetBehaviorArchetype,
  type PetBehaviorPersonality,
  type PetBehaviorState,
  resumePetBehavior,
  tickPetBehavior
} from '../petBehavior'

const personality: PetBehaviorPersonality = {
  archetype: 'scout',
  curiosity: 0.8,
  energyBias: 0.7,
  idlePauseMs: 800,
  pauseVarianceMs: 400,
  patience: 0.6,
  playfulness: 0.4,
  rhythmType: 'smooth',
  seed: 123,
  sleepMs: 1800,
  sleepVarianceMs: 800,
  sociality: 0.3,
  speedPxPerSecond: 40,
  waveMs: 700,
  walkMs: 2200,
  walkVarianceMs: 900
}

function walkingState(overrides: Partial<PetBehaviorState> = {}): PetBehaviorState {
  return {
    actionIndex: 0,
    direction: 1,
    lastMovedAt: 1000,
    lastTickAt: 1000,
    lastXRatio: 0.5,
    modeHistory: ['walking'],
    mode: 'walking',
    modeStartedAt: 1000,
    modeUntil: 4000,
    overlay: 'none',
    xRatio: 0.5,
    ...overrides
  }
}

describe('petBehavior', () => {
  it('creates stable per-animal personalities', () => {
    expect(createPetBehaviorPersonality('scout')).toEqual(createPetBehaviorPersonality('scout'))
    expect(createPetBehaviorPersonality('scout')).not.toEqual(createPetBehaviorPersonality('watcher'))
  })

  it('starts each animal with a stable independent walking direction', () => {
    expect(createInitialPetBehaviorState('animal-a', 0, 0.5, 1000)).toEqual(
      createInitialPetBehaviorState('animal-a', 0, 0.5, 1000)
    )
    expect(createInitialPetBehaviorState('animal-a', 0, 0.5, 1000).mode).toBe('observing')
  })

  it('resumes after a long task pause without turning the pause duration into movement', () => {
    const paused = walkingState({
      lastMovedAt: 1000,
      lastTickAt: 1000,
      mode: 'walking',
      modeUntil: 20_000,
      xRatio: 0.5
    })
    const resumed = resumePetBehavior(paused, 61_000)
    const update = tickPetBehavior(resumed, {
      maxLeft: 200,
      now: 61_016,
      personality
    })

    expect(update.xRatio).toBeCloseTo(0.5032)
    expect(update.state.lastTickAt).toBe(61_016)
  })

  it('begins ambient life in a calm observing mode instead of immediately roaming', () => {
    const initial = createInitialPetBehaviorState('animal-a', 0, 0.5, 1000)
    const update = tickPetBehavior(initial, {
      maxLeft: 200,
      now: 1800,
      personality
    })

    expect(update.xRatio).toBe(0.5)
    expect(update.animation).toBe('observe')
  })

  it('caps a walking pet movement to a small visual step and reports the directional walk animation', () => {
    const update = tickPetBehavior(walkingState(), {
      maxLeft: 200,
      now: 2000,
      personality
    })

    expect(update.xRatio).toBeCloseTo(0.52)
    expect(update.animation).toBe('walkRight')
    expect(update.sleeping).toBe(false)
    expect(update.state.lastMovedAt).toBe(2000)
  })

  it('clamps at pasture edges and turns back inward', () => {
    const update = tickPetBehavior(walkingState({ xRatio: 0.97, lastXRatio: 0.97 }), {
      maxLeft: 100,
      now: 1000 + 200,
      personality
    })

    expect(update.xRatio).toBe(1)
    expect(update.state.direction).toBe(-1)
    expect(update.animation).toBe('walkLeft')
  })

  it('recovers a walking pet that has been visually stuck for too long', () => {
    const update = tickPetBehavior(
      walkingState({
        lastMovedAt: 0,
        lastTickAt: 5000,
        mode: 'walking',
        modeStartedAt: 1000,
        modeUntil: 10_000,
        xRatio: 0.5
      }),
      {
        maxLeft: 240,
        now: 5000,
        personality
      }
    )

    expect(update.state.mode).toBe('walking')
    expect(['walkLeft', 'walkRight']).toContain(update.animation)
  })

  it('keeps position legal when the pasture is too narrow to move', () => {
    const update = tickPetBehavior(walkingState({ xRatio: 0.7 }), {
      maxLeft: 0,
      now: 2000,
      personality
    })

    expect(update.xRatio).toBe(0)
    expect(update.state.xRatio).toBe(0)
    expect(update.animation).toBe('idle')
  })

  it('assigns stable archetypes and broader personality traits per animal', () => {
    const first = createPetBehaviorPersonality('scout')
    const second = createPetBehaviorPersonality('watcher')

    expect(first).toEqual(createPetBehaviorPersonality('scout'))
    expect(['scout', 'napster', 'greeter', 'performer', 'companion', 'watcher']).toContain(first.archetype)
    expect(first).not.toEqual(second)
    expect(
      new Set(
        (['scout', 'napster', 'greeter', 'performer', 'companion', 'watcher'] as const).map(
          (archetype) => createPetBehaviorPersonality(archetype).archetype
        )
      ).size
    ).toBeGreaterThan(1)
    expect(first.energyBias).toBeGreaterThanOrEqual(0)
    expect(first.energyBias).toBeLessThanOrEqual(1)
    expect(first.sociality).toBeGreaterThanOrEqual(0)
    expect(first.sociality).toBeLessThanOrEqual(1)
  })

  it('keeps activity profiles deterministic without turning them into loud personalities', () => {
    const profiles = new Map<PetBehaviorArchetype, string>()
    for (const archetype of ['scout', 'napster', 'greeter', 'performer', 'companion', 'watcher'] as const) {
      let state = createInitialPetBehaviorState(`animal-${archetype}`, 0, 0.5, 1000)
      const archetypePersonality: PetBehaviorPersonality = {
        ...createPetBehaviorPersonality(archetype),
        idlePauseMs: personality.idlePauseMs,
        pauseVarianceMs: personality.pauseVarianceMs,
        sleepMs: personality.sleepMs,
        sleepVarianceMs: personality.sleepVarianceMs,
        walkMs: personality.walkMs,
        walkVarianceMs: personality.walkVarianceMs,
        waveMs: personality.waveMs
      }
      const modes: string[] = []

      for (let now = 1000; now <= 61_000; now += 1000) {
        const update = tickPetBehavior(state, {
          maxLeft: 420,
          now,
          personality: archetypePersonality
        })
        state = update.state
        modes.push(update.state.mode)
      }

      profiles.set(archetype, modes.join('|'))
    }

    expect(new Set(profiles.values()).size).toBeGreaterThan(1)
    expect(countMode(profiles.get('scout')!, 'walking')).toBeGreaterThan(countMode(profiles.get('napster')!, 'walking'))
    expect(countMode(profiles.get('napster')!, 'sleeping')).toBeGreaterThan(0)
  })

  it('changes a single pets behavior cadence across rhythm windows without changing personality', () => {
    const singlePersonality: PetBehaviorPersonality = {
      ...personality,
      archetype: 'watcher',
      curiosity: 0.72,
      energyBias: 0.38,
      seed: 707
    }
    const firstWindow = collectModes(singlePersonality, 1000)
    const secondWindow = collectModes(singlePersonality, 91_000)

    expect(singlePersonality.archetype).toBe('watcher')
    expect(firstWindow).not.toEqual(secondWindow)
  })

  it('suppresses additional walking when the scene already has too many active pets', () => {
    const activeState = walkingState({
      actionIndex: 4,
      mode: 'observing',
      modeUntil: 1000,
      xRatio: 0.45
    })
    const activePersonality: PetBehaviorPersonality = {
      ...personality,
      archetype: 'scout',
      curiosity: 1,
      energyBias: 1,
      seed: 404
    }

    const update = tickPetBehavior(activeState, {
      context: {
        nearbyPets: [{ animalId: 'animal-b', mode: 'walking', xRatio: 0.5 }],
        sceneEnergy: 0.75
      },
      maxLeft: 420,
      now: 1800,
      personality: activePersonality
    })

    expect(update.state.mode).not.toBe('walking')
  })

  it('does not globally suppress walking for every pet when scene energy comes from distant pets', () => {
    const activeState = walkingState({
      actionIndex: 5,
      mode: 'observing',
      modeUntil: 1000,
      xRatio: 0.45
    })
    const activePersonality: PetBehaviorPersonality = {
      ...personality,
      archetype: 'scout',
      curiosity: 1,
      energyBias: 1,
      seed: 404
    }

    const baseline = tickPetBehavior(activeState, {
      maxLeft: 420,
      now: 1800,
      personality: activePersonality
    })
    const update = tickPetBehavior(activeState, {
      context: {
        nearbyPets: [],
        sceneActivityHint: 'quiet',
        sceneEnergy: 0.75
      },
      maxLeft: 420,
      now: 1800,
      personality: activePersonality
    })

    expect(baseline.state.mode).toBe('walking')
    expect(update.state.mode).toBe(baseline.state.mode)
  })

  it('keeps autonomous idle behavior mostly quiet for agent standby use', () => {
    let state = createInitialPetBehaviorState('quiet-agent-pet', 0, 0.5, 1000)
    const quietPersonality = {
      ...personality,
      archetype: 'scout' as const,
      curiosity: 1,
      energyBias: 1,
      playfulness: 1,
      seed: 9001
    }
    const modes: string[] = []

    for (let now = 1000; now <= 181_000; now += 1000) {
      const update = tickPetBehavior(state, {
        context: {
          sceneActivityHint: 'normal',
          sceneEnergy: 0.25
        },
        maxLeft: 420,
        now,
        personality: quietPersonality
      })
      state = update.state
      modes.push(update.state.mode)
    }

    const activeCount = modes.filter((mode) => mode === 'walking' || mode === 'playing' || mode === 'waving').length
    expect(activeCount / modes.length).toBeLessThan(0.25)
  })

  it('lets session overlays dominate instead of autonomous personality behavior', () => {
    const idle = walkingState({
      actionIndex: 4,
      mode: 'observing',
      modeUntil: 1000,
      xRatio: 0.5
    })

    const update = tickPetBehavior(idle, {
      context: {
        streaming: 'streaming',
        suppressReason: 'bubble-visible',
        task: 'running'
      },
      maxLeft: 420,
      now: 1800,
      personality: {
        ...personality,
        archetype: 'performer',
        playfulness: 1,
        seed: 1234
      }
    })

    expect(update.state.overlay).toBe('taskRunning')
    expect(update.state.mode).toBe('observing')
    expect(update.xRatio).toBe(0.5)
    expect(update.animation).toBe('run')
  })

  it('clears task overlays when the task no longer suppresses ambient behavior', () => {
    const idle = walkingState({
      actionIndex: 4,
      mode: 'observing',
      modeUntil: 10_000,
      xRatio: 0.5
    })
    const taskRunning = tickPetBehavior(idle, {
      context: {
        suppressReason: 'task-bound',
        task: 'running'
      },
      maxLeft: 420,
      now: 1800,
      personality
    })
    const resumed = tickPetBehavior(taskRunning.state, {
      maxLeft: 420,
      now: 1900,
      personality
    })

    expect(taskRunning.state.overlay).toBe('taskRunning')
    expect(taskRunning.state.suppressedAmbientSnapshot).toEqual(
      expect.objectContaining({
        mode: 'observing',
        xRatio: 0.5
      })
    )
    expect(resumed.state.overlay).toBe('none')
    expect(resumed.state.suppressedAmbientSnapshot).toBeUndefined()
    expect(resumed.animation).toBe('observe')
  })

  it('uses nearby pets to create social observation instead of more meaningless walking', () => {
    const idle = walkingState({
      actionIndex: 4,
      mode: 'observing',
      modeUntil: 1000,
      xRatio: 0.5
    })
    const socialPersonality: PetBehaviorPersonality = {
      ...personality,
      archetype: 'companion',
      sociality: 1,
      seed: 404
    }

    const update = tickPetBehavior(idle, {
      context: {
        nearbyPets: [{ animalId: 'animal-b', mode: 'playing', xRatio: 0.54 }]
      },
      maxLeft: 420,
      now: 1800,
      personality: socialPersonality
    })

    expect(update.state.mode).toBe('socializing')
    expect(update.animation).toBe('wave')
    expect(update.xRatio).toBe(0.5)
  })

  it('renders quiet personality modes with distinct semantic animations', () => {
    expect(
      tickPetBehavior(walkingState({ mode: 'sleeping', modeUntil: 10_000 }), {
        maxLeft: 420,
        now: 2000,
        personality
      }).animation
    ).toBe('sleep')
    expect(
      tickPetBehavior(walkingState({ mode: 'observing', modeUntil: 10_000 }), {
        maxLeft: 420,
        now: 2000,
        personality
      }).animation
    ).toBe('observe')
  })

  it('keeps stream overlays position-owned by ambient state and settles before resuming', () => {
    const walking = walkingState({ xRatio: 0.42, lastXRatio: 0.42, modeUntil: 10_000 })
    const streaming = tickPetBehavior(walking, {
      context: {
        suppressReason: 'bubble-visible',
        streaming: 'streaming'
      },
      maxLeft: 420,
      now: 2000,
      personality
    })
    const settled = tickPetBehavior(streaming.state, {
      context: {
        streaming: 'complete'
      },
      maxLeft: 420,
      now: 3000,
      personality
    })

    expect(streaming.state.overlay).toBe('responding')
    expect(streaming.xRatio).toBe(0.42)
    expect(settled.state.mode).toBe('settling')
    expect(settled.state.overlay).toBe('settling')
    expect(Math.abs(settled.xRatio - 0.42)).toBeLessThan(0.01)
  })

  it('clears stream suppression snapshots after settling back to ambient behavior', () => {
    const walking = walkingState({ xRatio: 0.42, lastXRatio: 0.42, modeUntil: 10_000 })
    const streaming = tickPetBehavior(walking, {
      context: {
        suppressReason: 'bubble-visible',
        streaming: 'streaming'
      },
      maxLeft: 420,
      now: 2000,
      personality
    })
    const settled = tickPetBehavior(streaming.state, {
      context: {
        streaming: 'complete'
      },
      maxLeft: 420,
      now: 3000,
      personality
    })
    const ambient = tickPetBehavior(settled.state, {
      maxLeft: 420,
      now: settled.state.modeUntil + 1,
      personality
    })

    expect(streaming.state.suppressedAmbientSnapshot).toEqual(
      expect.objectContaining({
        mode: 'walking',
        xRatio: 0.42
      })
    )
    expect(settled.state.overlay).toBe('settling')
    expect(ambient.state.overlay).toBe('none')
    expect(ambient.state.suppressedAmbientSnapshot).toBeUndefined()
  })
})

function countMode(profile: string, mode: string): number {
  return profile.split('|').filter((entry) => entry === mode).length
}

function collectModes(personality: PetBehaviorPersonality, startAt: number): string[] {
  let state = createInitialPetBehaviorState(`single-${personality.seed}`, 0, 0.5, startAt)
  const modes: string[] = []
  for (let now = startAt; now <= startAt + 60_000; now += 1000) {
    const update = tickPetBehavior(state, {
      maxLeft: 420,
      now,
      personality
    })
    state = update.state
    modes.push(update.state.mode)
  }
  return modes
}
