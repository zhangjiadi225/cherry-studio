import type { PetPersonality, PetSemanticAnimationName } from '@shared/pet'

export type PetBehaviorMode =
  | 'observing'
  | 'walking'
  | 'pausing'
  | 'waving'
  | 'sleeping'
  | 'playing'
  | 'socializing'
  | 'settling'

export type PetBehaviorArchetype = PetPersonality

export type PetBehaviorRhythmType = 'smooth' | 'bursty' | 'sleepy' | 'reactive'

export type PetBehaviorOverlay =
  | 'none'
  | 'listening'
  | 'responding'
  | 'taskRunning'
  | 'taskWaiting'
  | 'taskSuccess'
  | 'taskError'
  | 'settling'

export type PetBehaviorSuppressReason = 'task-bound' | 'bubble-visible' | 'dragging' | 'bubble-held' | 'reply-draft'

export type PetBehaviorStreamState = 'idle' | 'starting' | 'streaming' | 'complete'

export type PetBehaviorTaskState = 'idle' | 'running' | 'waiting' | 'review' | 'success' | 'error' | 'aborted'

export type PetBehaviorNearbyPet = {
  animalId: string
  mode: PetBehaviorMode
  xRatio: number
}

export type PetBehaviorContext = {
  nearbyPets?: PetBehaviorNearbyPet[]
  sceneActivityHint?: 'quiet' | 'normal' | 'active'
  sceneEnergy?: number
  streamCompletedAt?: number
  streaming?: PetBehaviorStreamState
  suppressReason?: PetBehaviorSuppressReason
  task?: PetBehaviorTaskState
  userFocus?: 'none' | 'hover' | 'active'
}

export type PetBehaviorMood = {
  attention: number
  comfort: number
  energy: number
  playfulness: number
  restlessness: number
}

export type PetBehaviorAmbientSnapshot = {
  direction: -1 | 1
  lastXRatio: number
  mode: PetBehaviorMode
  modeUntil: number
  xRatio: number
}

export type PetBehaviorPersonality = {
  archetype: PetBehaviorArchetype
  curiosity: number
  energyBias: number
  idlePauseMs: number
  pauseVarianceMs: number
  patience: number
  playfulness: number
  rhythmType: PetBehaviorRhythmType
  seed: number
  sleepMs: number
  sleepVarianceMs: number
  sociality: number
  speedPxPerSecond: number
  waveMs: number
  walkMs: number
  walkVarianceMs: number
}

export type PetBehaviorState = {
  actionIndex: number
  direction: -1 | 1
  lastMovedAt: number
  lastTickAt: number
  lastXRatio: number
  mode: PetBehaviorMode
  modeHistory: PetBehaviorMode[]
  modeStartedAt: number
  modeUntil: number
  mood?: PetBehaviorMood
  overlay: PetBehaviorOverlay
  targetXRatio?: number
  cooldowns?: Partial<Record<PetBehaviorMode | PetBehaviorOverlay, number>>
  suppressedAmbientSnapshot?: PetBehaviorAmbientSnapshot
  xRatio: number
}

export type PetBehaviorTickInput = {
  context?: PetBehaviorContext
  maxLeft: number
  now: number
  personality: PetBehaviorPersonality
}

export type PetBehaviorTickResult = {
  animation: PetSemanticAnimationName
  sleeping: boolean
  state: PetBehaviorState
  xRatio: number
}

const MIN_WALK_SPEED = 28
const WALK_SPEED_SPAN = 22
const STUCK_MS = 4000
const MIN_MOVEMENT_RATIO = 0.002
const MAX_TICK_MS = 100

type ArchetypeDefaults = {
  curiosity: number
  energyBias: number
  idlePauseMs: number
  patience: number
  playfulness: number
  rhythmType: PetBehaviorRhythmType
  seed: number
  sleepMs: number
  sociality: number
  speedPxPerSecond: number
  playFactor: number
  sleepFactor: number
  socialFactor: number
  walkFactor: number
  walkMs: number
  waveFactor: number
}

export function createPetBehaviorPersonality(personality: PetPersonality): PetBehaviorPersonality {
  const archetypeDefaults = getArchetypeDefaults(personality)

  return {
    archetype: personality,
    curiosity: archetypeDefaults.curiosity,
    energyBias: archetypeDefaults.energyBias,
    idlePauseMs: archetypeDefaults.idlePauseMs,
    pauseVarianceMs: 1400,
    patience: archetypeDefaults.patience,
    playfulness: archetypeDefaults.playfulness,
    rhythmType: archetypeDefaults.rhythmType,
    seed: archetypeDefaults.seed,
    sleepMs: archetypeDefaults.sleepMs,
    sleepVarianceMs: 2200,
    sociality: archetypeDefaults.sociality,
    speedPxPerSecond: archetypeDefaults.speedPxPerSecond,
    waveMs: 700,
    walkMs: archetypeDefaults.walkMs,
    walkVarianceMs: 900
  }
}

export function createInitialPetBehaviorState(
  animalId: string,
  order: number,
  xRatio: number,
  now: number
): PetBehaviorState {
  const seed = hashString(`${animalId}:${order}:initial`)
  const direction = seededUnit(seed, 1) >= 0.5 ? 1 : -1

  return {
    actionIndex: 0,
    direction,
    lastMovedAt: now,
    lastTickAt: now,
    lastXRatio: clampRatio(xRatio),
    mode: 'observing',
    modeHistory: ['observing'],
    modeStartedAt: now,
    modeUntil: now + 1600 + Math.round(seededUnit(seed, 2) * 1200),
    mood: {
      attention: 0.5,
      comfort: 0.5,
      energy: 0.5,
      playfulness: 0.5,
      restlessness: 0.5
    },
    overlay: 'none',
    xRatio: clampRatio(xRatio)
  }
}

export function resumePetBehavior(state: PetBehaviorState, now: number): PetBehaviorState {
  return {
    ...state,
    lastMovedAt: now,
    lastTickAt: now,
    modeUntil: Math.max(state.modeUntil, now + 500)
  }
}

export function tickPetBehavior(state: PetBehaviorState, input: PetBehaviorTickInput): PetBehaviorTickResult {
  const maxLeft = Math.max(0, input.maxLeft)
  const now = Math.max(input.now, state.lastTickAt)
  const context = input.context ?? {}
  const hydratedState = hydrateState(state)

  if (maxLeft <= 0) {
    return toResult({
      ...hydratedState,
      lastMovedAt: now,
      lastTickAt: now,
      lastXRatio: 0,
      mode: 'pausing',
      overlay: 'none',
      xRatio: 0
    })
  }

  let nextState = applyOverlay(hydratedState, input.personality, context, now)
  if (context.suppressReason) {
    return toResult({
      ...nextState,
      lastMovedAt: now,
      lastTickAt: now,
      suppressedAmbientSnapshot: nextState.suppressedAmbientSnapshot ?? toAmbientSnapshot(nextState)
    })
  }

  const elapsedMs = Math.min(now - nextState.lastTickAt, MAX_TICK_MS)
  if (now >= nextState.modeUntil) {
    nextState = advanceMode(nextState, input.personality, context, now)
  }

  if (nextState.mode === 'walking' && now - nextState.lastMovedAt >= STUCK_MS) {
    nextState = forceWalking(nextState, input.personality, now, maxLeft)
  }

  if (nextState.mode !== 'walking') {
    return toResult({
      ...nextState,
      lastTickAt: now
    })
  }

  const deltaRatio = (input.personality.speedPxPerSecond * (elapsedMs / 1000)) / maxLeft
  const moved = moveWithEdges(nextState.xRatio, nextState.direction, deltaRatio)
  const movedEnough = Math.abs(moved.xRatio - nextState.lastXRatio) >= MIN_MOVEMENT_RATIO

  return toResult({
    ...nextState,
    direction: moved.direction,
    lastMovedAt: movedEnough ? now : nextState.lastMovedAt,
    lastTickAt: now,
    lastXRatio: moved.xRatio,
    xRatio: moved.xRatio
  })
}

export function resetPetBehaviorPosition(
  state: PetBehaviorState,
  xRatio: number,
  now: number,
  direction?: -1 | 1
): PetBehaviorState {
  const nextRatio = clampRatio(xRatio)
  return {
    ...state,
    direction: direction ?? state.direction,
    lastMovedAt: now,
    lastTickAt: now,
    lastXRatio: nextRatio,
    mode: 'walking',
    modeHistory: [...(state.modeHistory ?? [state.mode]).slice(-7), 'walking'],
    modeStartedAt: now,
    modeUntil: now + 1200,
    overlay: 'none',
    xRatio: nextRatio
  }
}

function advanceMode(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  context: PetBehaviorContext,
  now: number
): PetBehaviorState {
  return chooseNextMode(state, personality, context, now)
}

function chooseNextMode(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  context: PetBehaviorContext,
  now: number
): PetBehaviorState {
  const actionIndex = state.actionIndex + 1
  const mode = pickWeightedMode(
    getModeWeights(state, personality, context, now),
    personality.seed,
    actionIndex + getRhythmWindow(personality, now) * 31
  )
  return startMode(state, personality, now, actionIndex, mode, context)
}

function forceWalking(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  now: number,
  maxLeft: number
): PetBehaviorState {
  return startMode(
    {
      ...state,
      direction: getInwardDirection(state.xRatio, state.direction, maxLeft)
    },
    personality,
    now,
    state.actionIndex + 1,
    'walking',
    {}
  )
}

function startMode(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  now: number,
  actionIndex: number,
  mode: PetBehaviorMode,
  context: PetBehaviorContext = {}
): PetBehaviorState {
  const duration = getModeDuration(mode, personality, actionIndex)
  const cooldowns = decayCooldowns(state.cooldowns, now)
  return {
    ...state,
    actionIndex,
    cooldowns: {
      ...cooldowns,
      ...(mode === 'waving' ? { waving: now + 7000 } : {}),
      ...(mode === 'playing' ? { playing: now + 9000 } : {}),
      ...(mode === 'socializing' ? { socializing: now + 6000 } : {}),
      ...(mode === 'sleeping' ? { sleeping: now + 12_000 } : {})
    },
    mode,
    modeHistory: [...state.modeHistory.slice(-7), mode],
    modeStartedAt: now,
    modeUntil: now + duration,
    mood: updateMood(state, personality, context, now),
    overlay: state.overlay === 'settling' && mode !== 'settling' ? 'none' : state.overlay,
    suppressedAmbientSnapshot:
      state.overlay === 'settling' && mode !== 'settling' ? undefined : state.suppressedAmbientSnapshot
  }
}

function getModeDuration(mode: PetBehaviorMode, personality: PetBehaviorPersonality, actionIndex: number): number {
  const variance = seededUnit(personality.seed, actionIndex + 17)
  switch (mode) {
    case 'observing':
      return personality.idlePauseMs + 450 + Math.round(variance * personality.pauseVarianceMs)
    case 'walking':
      return personality.walkMs + Math.round(variance * personality.walkVarianceMs)
    case 'pausing':
      return personality.idlePauseMs + Math.round(variance * personality.pauseVarianceMs)
    case 'sleeping':
      return personality.sleepMs + Math.round(variance * personality.sleepVarianceMs)
    case 'socializing':
      return 1600 + Math.round(variance * 1000)
    case 'settling':
      return 600 + Math.round(variance * 600)
    case 'waving':
      return Math.max(1000, personality.waveMs)
    case 'playing':
      return 1400 + Math.round(variance * 800)
  }
}

function moveWithEdges(xRatio: number, direction: -1 | 1, deltaRatio: number): { direction: -1 | 1; xRatio: number } {
  const raw = xRatio + direction * deltaRatio
  if (raw >= 1) return { direction: -1, xRatio: 1 }
  if (raw <= 0) return { direction: 1, xRatio: 0 }
  return { direction, xRatio: raw }
}

function getInwardDirection(xRatio: number, direction: -1 | 1, maxLeft: number): -1 | 1 {
  if (maxLeft <= 0) return direction
  if (xRatio >= 0.94) return -1
  if (xRatio <= 0.06) return 1
  return direction
}

function toResult(state: PetBehaviorState): PetBehaviorTickResult {
  return {
    animation: getAnimation(state),
    sleeping: state.mode === 'sleeping',
    state,
    xRatio: state.xRatio
  }
}

function getAnimation(state: PetBehaviorState): PetSemanticAnimationName {
  if (state.overlay === 'taskRunning') return 'run'
  if (state.overlay === 'taskWaiting') return 'waiting'
  if (state.overlay === 'taskSuccess') return 'celebrate'
  if (state.overlay === 'taskError') return 'failed'
  if (state.overlay === 'listening') return 'observe'
  if (state.overlay === 'responding') return 'run'
  if (state.overlay === 'settling') return 'observe'
  switch (state.mode) {
    case 'walking':
      return state.direction > 0 ? 'walkRight' : 'walkLeft'
    case 'waving':
      return 'wave'
    case 'playing':
      return 'play'
    case 'observing':
      return 'observe'
    case 'sleeping':
      return 'sleep'
    case 'socializing':
      return 'wave'
    case 'pausing':
    case 'settling':
      return 'idle'
  }
}

function hydrateState(state: PetBehaviorState): PetBehaviorState {
  return {
    ...state,
    modeHistory: state.modeHistory ?? [state.mode],
    overlay: state.overlay ?? 'none'
  }
}

function applyOverlay(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  context: PetBehaviorContext,
  now: number
): PetBehaviorState {
  const taskOverlay = getTaskOverlay(context.task)
  if (taskOverlay !== 'none') {
    return {
      ...state,
      lastTickAt: now,
      overlay: taskOverlay,
      suppressedAmbientSnapshot: state.suppressedAmbientSnapshot ?? toAmbientSnapshot(state)
    }
  }
  if (context.streaming === 'streaming' || context.streaming === 'starting') {
    return {
      ...state,
      lastTickAt: now,
      overlay: context.streaming === 'starting' ? 'listening' : 'responding',
      suppressedAmbientSnapshot: state.suppressedAmbientSnapshot ?? toAmbientSnapshot(state)
    }
  }
  if (context.streaming === 'complete' && (state.overlay === 'responding' || state.overlay === 'listening')) {
    return startMode({ ...state, overlay: 'settling' }, personality, now, state.actionIndex + 1, 'settling', context)
  }
  if (isTaskOverlay(state.overlay)) {
    return {
      ...state,
      overlay: 'none',
      suppressedAmbientSnapshot: undefined
    }
  }
  return state.overlay === 'responding' || state.overlay === 'listening' ? { ...state, overlay: 'settling' } : state
}

function isTaskOverlay(overlay: PetBehaviorOverlay): boolean {
  return overlay === 'taskRunning' || overlay === 'taskWaiting' || overlay === 'taskSuccess' || overlay === 'taskError'
}

function getTaskOverlay(task: PetBehaviorTaskState | undefined): PetBehaviorOverlay {
  switch (task) {
    case 'running':
    case 'review':
      return 'taskRunning'
    case 'waiting':
      return 'taskWaiting'
    case 'success':
      return 'taskSuccess'
    case 'error':
      return 'taskError'
    case 'aborted':
    case 'idle':
    case undefined:
      return 'none'
  }
}

function toAmbientSnapshot(state: PetBehaviorState): PetBehaviorAmbientSnapshot {
  return {
    direction: state.direction,
    lastXRatio: state.lastXRatio,
    mode: state.mode,
    modeUntil: state.modeUntil,
    xRatio: state.xRatio
  }
}

function getModeWeights(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  context: PetBehaviorContext,
  now: number
): Partial<Record<PetBehaviorMode, number>> {
  const mood = updateMood(state, personality, context, now)
  const cooldowns = decayCooldowns(state.cooldowns, now)
  const nearby = context.nearbyPets ?? []
  const nearActivePet = nearby.some((pet) => Math.abs(pet.xRatio - state.xRatio) <= 0.08)
  const nearActiveMotionPet = nearby.some(
    (pet) => Math.abs(pet.xRatio - state.xRatio) <= 0.08 && isActivePetMode(pet.mode)
  )
  const sceneHasLocalPressure = nearActiveMotionPet || isActivePetMode(state.mode)
  const repeated = state.modeHistory.slice(-2).filter((mode) => mode === state.mode).length >= 2
  const archetype = getArchetypeDefaults(personality.archetype)
  const rhythm = getRhythmModifiers(personality, now)
  const agentStandbyFactor = context.task && context.task !== 'idle' ? 0.05 : 1
  const weights: Partial<Record<PetBehaviorMode, number>> = {
    observing: 28 + personality.curiosity * 8 + mood.attention * 5,
    walking: 2.2 + personality.energyBias * 3.3 + personality.curiosity * 2.6 + mood.restlessness * 2.2,
    pausing: 24 + personality.patience * 9 + mood.comfort * 10,
    waving: 1.5 + personality.sociality * 4.5 + mood.attention * 2.4,
    sleeping: 3 + (1 - personality.energyBias) * 12 + mood.comfort * 8,
    playing: 0.9 + personality.playfulness * 5.2 + mood.playfulness * 3.2,
    socializing: nearActivePet ? 8 + personality.sociality * 34 : Math.max(0, personality.sociality * 5 - 1)
  }

  weights.observing = (weights.observing ?? 0) * rhythm.observeFactor
  weights.walking = (weights.walking ?? 0) * softenFactor(archetype.walkFactor) * rhythm.walkFactor * agentStandbyFactor
  weights.sleeping = (weights.sleeping ?? 0) * archetype.sleepFactor * rhythm.sleepFactor
  weights.playing = (weights.playing ?? 0) * softenFactor(archetype.playFactor) * rhythm.playFactor * agentStandbyFactor
  weights.waving = (weights.waving ?? 0) * softenFactor(archetype.waveFactor) * rhythm.socialFactor * agentStandbyFactor
  weights.socializing = (weights.socializing ?? 0) * softenFactor(archetype.socialFactor) * rhythm.socialFactor
  if (context.userFocus === 'hover') {
    weights.observing = (weights.observing ?? 0) + 10
    weights.waving = (weights.waving ?? 0) + personality.sociality * 7
    weights.socializing = (weights.socializing ?? 0) + personality.sociality * 5
  }
  if (context.streaming === 'complete') {
    weights.waving = (weights.waving ?? 0) + personality.sociality * 7
    weights.observing = (weights.observing ?? 0) + 6
  }
  if (state.xRatio <= 0.06 || state.xRatio >= 0.94) {
    weights.walking = (weights.walking ?? 0) + 18
  }
  if (((context.sceneEnergy ?? 0) >= 0.5 || context.sceneActivityHint === 'quiet') && sceneHasLocalPressure) {
    weights.walking = Math.max(0.5, (weights.walking ?? 0) * 0.12)
    weights.observing = (weights.observing ?? 0) + 14
    weights.pausing = (weights.pausing ?? 0) + 10
    weights.sleeping = (weights.sleeping ?? 0) + 8
  }
  if (context.sceneActivityHint === 'normal') {
    weights.walking = Math.max(0.5, (weights.walking ?? 0) * 0.42)
    weights.playing = Math.max(0.5, (weights.playing ?? 0) * 0.58)
    weights.waving = Math.max(0.6, (weights.waving ?? 0) * 0.72)
    weights.observing = (weights.observing ?? 0) + 8
    weights.pausing = (weights.pausing ?? 0) + 7
  }
  if (repeated) {
    weights[state.mode] = Math.max(1, (weights[state.mode] ?? 1) * 0.25)
  }
  for (const [mode, until] of Object.entries(cooldowns) as Array<[PetBehaviorMode, number]>) {
    if (until > now) weights[mode] = Math.max(0.5, (weights[mode] ?? 0) * 0.18)
  }
  if (personality.archetype === 'companion' && nearActivePet && personality.sociality >= 0.75) {
    weights.socializing = 100
    weights.walking = 1.2
  }
  return weights
}

function isActivePetMode(mode: PetBehaviorMode): boolean {
  return mode === 'walking' || mode === 'playing' || mode === 'waving'
}

function softenFactor(factor: number): number {
  return 1 + (factor - 1) * 0.35
}

function pickWeightedMode(
  weights: Partial<Record<PetBehaviorMode, number>>,
  seed: number,
  actionIndex: number
): PetBehaviorMode {
  const entries = Object.entries(weights).filter((entry): entry is [PetBehaviorMode, number] => entry[1] > 0)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = seededUnit(seed, actionIndex) * total
  for (const [mode, weight] of entries) {
    roll -= weight
    if (roll <= 0) return mode
  }
  return entries.at(-1)?.[0] ?? 'observing'
}

function updateMood(
  state: PetBehaviorState,
  personality: PetBehaviorPersonality,
  context: PetBehaviorContext,
  now: number
): PetBehaviorMood {
  const current = state.mood ?? {
    attention: personality.sociality,
    comfort: personality.patience,
    energy: personality.energyBias,
    playfulness: personality.playfulness,
    restlessness: personality.curiosity
  }
  const phase = seededUnit(personality.seed, Math.floor(now / 30_000) + 100)
  return {
    attention: clamp01(current.attention * 0.78 + (context.userFocus === 'hover' ? 0.22 : personality.sociality * 0.1)),
    comfort: clamp01(current.comfort * 0.85 + (1 - personality.energyBias) * 0.12 + phase * 0.04),
    energy: clamp01(current.energy * 0.82 + personality.energyBias * 0.16 + phase * 0.04),
    playfulness: clamp01(
      current.playfulness * 0.8 + personality.playfulness * 0.16 + (context.streaming === 'complete' ? 0.1 : 0)
    ),
    restlessness: clamp01(current.restlessness * 0.76 + personality.curiosity * 0.18 + phase * 0.08)
  }
}

function getRhythmWindow(personality: PetBehaviorPersonality, now: number): number {
  return Math.floor(now / getRhythmWindowMs(personality.rhythmType))
}

function getRhythmWindowMs(rhythmType: PetBehaviorRhythmType): number {
  switch (rhythmType) {
    case 'bursty':
      return 30_000
    case 'reactive':
      return 45_000
    case 'sleepy':
      return 90_000
    case 'smooth':
      return 60_000
  }
}

function getRhythmModifiers(
  personality: PetBehaviorPersonality,
  now: number
): {
  observeFactor: number
  playFactor: number
  sleepFactor: number
  socialFactor: number
  walkFactor: number
} {
  const phase = seededUnit(personality.seed, getRhythmWindow(personality, now) + 211)
  if (phase < 0.22) {
    return { observeFactor: 1.25, playFactor: 0.55, sleepFactor: 1.6, socialFactor: 0.65, walkFactor: 0.45 }
  }
  if (phase < 0.48) {
    return { observeFactor: 1.35, playFactor: 0.8, sleepFactor: 0.9, socialFactor: 1.05, walkFactor: 0.65 }
  }
  if (phase < 0.74) {
    return { observeFactor: 0.85, playFactor: 1.2, sleepFactor: 0.55, socialFactor: 1.2, walkFactor: 1.05 }
  }
  return { observeFactor: 0.75, playFactor: 1.45, sleepFactor: 0.4, socialFactor: 1.1, walkFactor: 1.25 }
}

function decayCooldowns(
  cooldowns: PetBehaviorState['cooldowns'],
  now: number
): Partial<Record<PetBehaviorMode | PetBehaviorOverlay, number>> {
  return Object.fromEntries(Object.entries(cooldowns ?? {}).filter(([, until]) => until > now))
}

function getArchetypeDefaults(archetype: PetBehaviorArchetype): ArchetypeDefaults {
  switch (archetype) {
    case 'scout':
      return makeDefaults(0.92, 0.86, 0.32, 0.48, 'smooth', 0.36, 1.0, 0.36, 0.72, 2.35, 0.9, 101)
    case 'napster':
      return makeDefaults(0.2, 0.18, 0.88, 0.14, 'sleepy', 0.26, 0.36, 2.65, 0.46, 0.22, 0.45, 211)
    case 'greeter':
      return makeDefaults(0.54, 0.54, 0.56, 0.48, 'reactive', 0.92, 0.85, 0.65, 1.32, 0.95, 2.35, 307)
    case 'performer':
      return makeDefaults(0.68, 0.78, 0.36, 0.96, 'bursty', 0.58, 2.75, 0.36, 0.82, 1.12, 1.45, 419)
    case 'companion':
      return makeDefaults(0.5, 0.58, 0.68, 0.54, 'reactive', 0.96, 0.95, 0.72, 2.7, 0.78, 1.25, 503)
    case 'watcher':
      return makeDefaults(0.82, 0.36, 0.9, 0.22, 'smooth', 0.42, 0.42, 1.05, 0.82, 0.44, 0.62, 617)
  }
}

function makeDefaults(
  curiosity: number,
  energyBias: number,
  patience: number,
  playfulness: number,
  rhythmType: PetBehaviorRhythmType,
  sociality: number,
  playFactor: number,
  sleepFactor: number,
  socialFactor: number,
  walkFactor: number,
  waveFactor: number,
  seed: number
): ArchetypeDefaults {
  return {
    curiosity,
    energyBias,
    idlePauseMs: 1600 + Math.round(seededUnit(seed, 1) * 1200),
    patience,
    playFactor,
    playfulness,
    rhythmType,
    seed,
    sleepFactor,
    sleepMs: 3200 + Math.round(seededUnit(seed, 2) * 1600),
    socialFactor,
    sociality,
    speedPxPerSecond: MIN_WALK_SPEED + Math.round(seededUnit(seed, 3) * WALK_SPEED_SPAN),
    walkFactor,
    walkMs: 900 + Math.round(seededUnit(seed, 4) * 700),
    waveFactor
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function clampRatio(value: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0.5, 0), 1)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(seed: number, salt: number): number {
  let value = seed + Math.imul(salt, 0x9e3779b9)
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return (value >>> 0) / 0x100000000
}
