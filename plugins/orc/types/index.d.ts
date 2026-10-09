export type OrcClass = 'navigate' | 'mechanic' | 'verify' | 'docs' | 'delegate' | 'human' | 'external' | 'other'

/** Study codebook (orchestrator-bench docs/STUDY_PLAN.md): A bookkeeping/state, B dispatch,
 *  C supervision/waiting, D intake/truth-finding, E review orchestration, F environment/ops,
 *  G recovery/continuity, H owner communication, I judgment, J hands-on worker work. */
export type OrcActivity = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'

export type OrcBucket = { count: number; ms: number; inBytes: number; outBytes: number; failed: number }

export type OrcTurn = {
  n: number
  turnId: string
  startedAt: number
  endedAt?: number
  prompt: string
  answer?: string
  reason?: string
  steps: number
  modelMs: number
  contextTokens: number
  outputTokens: number
  /** model output split by destination, in characters: prose to the person, thinking, tool arguments (code, commands) */
  outProseChars: number
  outThinkChars: number
  outArgChars: number
  classes: Partial<Record<OrcClass, OrcBucket>>
  activities: Partial<Record<OrcActivity, OrcBucket>>
  tools: { tool: string; cls: OrcClass; act: OrcActivity; ms: number; inBytes: number; outBytes: number; what: string }[]
  spawned: string[]
  finished: { id: string; type: string; ms: number; tools: number; outputTokens: number }[]
  /** 0.22.0 ledger: set when the prompt was an orc wake ("[orc wake]" / "[orc inbox]" / "[orc graph]"): why the orchestrator woke */
  wake?: string
  /** 0.22.0 ledger: the turn's input tokens (input + cache read + cache write, from the engine's usage at turn end) */
  inTokens?: number
}

export type OrcAgent = {
  id: string
  type: string
  description: string
  model?: string
  status: string
  startedAt: number
  endedAt?: number
  toolCalls: number
  toolErrors: number
  lastTool?: string
  /** Steering messages from the orchestrator: read with the child's next tool result, or sent as a resume once it had finished. */
  steers?: { at: number; text: string; deliveredAt?: number; via?: 'tool-result' | 'resume' }[]
  promptChars: number
  steps: number
  modelMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** tokens written to the prompt cache (usage.cache_creation_input_tokens); with cache reads, input and output this is the full count */
  cacheWriteTokens?: number
  parentId?: string
  answerHead?: string
  /** same accounting as a main-loop turn, for agents the mod watches closely (orc:* types) */
  classes: Partial<Record<OrcClass, OrcBucket>>
  activities: Partial<Record<OrcActivity, OrcBucket>>
  tools: { tool: string; cls: OrcClass; act: OrcActivity; ms: number; inBytes: number; outBytes: number; what: string }[]
  outProseChars: number
  outThinkChars: number
  outArgChars: number
  ctxTokens: number
  ctxMax: number
  ctxFirst: number
  children: number
  runs: number
  /** ledger (switch 1): the orchestrator's verdict on this child, recorded via mcp__orc__mark (the latest of `marks`) */
  mark?: { verdict: 'accepted' | 'rejected' | 'redo'; note: string; at: number; by?: string }
  /** WO-0220c: every mark ever recorded on this child, oldest first (a redo, then the accepted re-run): never shrinks */
  marks?: { verdict: 'accepted' | 'rejected' | 'redo'; note: string; at: number; by?: string }[]
  /** ledger: full final report saved to a file; the wake carries the latest in full, older ones as pointers */
  reportPath?: string
  reportBytes?: number
  reportDigest?: string
  /** ledger: per-orchestrator event cursor at which this child returned */
  returnedCursor?: number
  cursor?: number
  /** switch 2: a check registered at dispatch (CHECK:/CHECK_CWD: lines in the Agent prompt), run by the mod on return */
  /** switch 2b: for an auto-verify orchestrator, the trigger files seen so far (path → content digest) and the repo root */
  autoSeen?: Record<string, string>
  autoRepo?: string
  autoBusy?: boolean
  /** switch 3: write boundary from MAY_CHANGE: lines (repo-relative paths/dirs under root); denials recorded; audit at return */
  boundary?: { root: string; allow: string[] }
  denied?: { tool: string; target: string; reason: string; at: number }[]
  boundaryReport?: { outside: string[]; othersRunning: string[]; checkedAt: number }
  /** switch 3 (reshaped): shell writes are not denied, only flagged for the audit */
  suspects?: { tool: string; target: string; reason: string; at: number }[]
  /** switch 4: the builder's own clone (git worktree + branch) and what happened at acceptance */
  worktree?: { path: string; branch: string; base: string; merged?: 'merged' | 'conflict' | 'nothing' | 'error'; mergeNote?: string; mergeSha?: string; uncommitted?: string[]; pruned?: boolean }
  /** event-driven: verification requests this orchestrator made (receipts) */
  verifyRequests?: { id: string; stage: 'checkpoint' | 'final' | 'integration'; at: number; repo: string; snapshot?: string; pruned?: boolean }[]
  /** integration mode: the repository-level check the integrator owns; `due` is set by a merge and consumed by the sweep */
  integration?: {
    repo: string
    due?: { after: string; branch: string; at: number }
    runs: { at: number; after: string; status: 'pass' | 'fail' | 'unavailable'; exitCode: number | null; ms: number; tail: string; reported: boolean; redispatched?: boolean; load?: number; cores?: number }[]
    dispatches: { at: number; reason: string }[]
  }
  /** true while the turn.complete relay (registered check, audit, wake) is running for this child; the dead-man sweep skips it */
  relaying?: boolean
  /** liveness: last tool call time and whether the parent was told about a stall */
  lastProgressAt?: number
  livenessNotified?: boolean
  /** wakes addressed to this orchestrator while it was busy; flushed when its turn completes */
  pendingWakes?: { text: string; childId: string; at: number }[]
  /** switch 3 (reshaped): mechanical dispatch preflight */
  preflight?: { ok: boolean; hard: string[]; soft: string[]; at: number }
  check?: { command: string; cwd: string; timeoutMs?: number }
  checkResult?: { status: 'pass' | 'fail' | 'unavailable'; exitCode: number | null; ms: number; outputTail: string; reason?: string }
  /** WO-0220c: every registered check run, one per return, oldest first (`checkResult` is the latest): never shrinks */
  checks?: { at: number; status: 'pass' | 'fail' | 'unavailable'; exitCode: number | null; ms: number; outputTail: string; reason?: string }[]
  /** 0.22.0 ledger: a verifier's report parsed on return (VERDICT / CRITERIA / DEFECTS lines), never the orchestrator's count */
  verifierCounts?: { verdict: 'PASS' | 'FAIL' | 'none'; pass: number; fail: number; na: number; defects: number }
}

/** Owner intake (packet 1): the WorkHub owner-journey package. */
export type OrcEvidenceItem = { id: string; text: string; classification: 'supplied' | 'reported_information' | 'proposed_interpretation'; role: 'context' | 'constraint' | 'exclusion' | 'success' | 'deliverable' | 'correction'; source: string }
export type OrcUnderstanding = {
  mission: { statement: string; deliverables: string[] }
  finalPicture: { summary: string; criteria: { id: string; description: string }[]; constraints: string[]; exclusions: string[] }
  plan: { nodes: { id: string; objective: string; acceptanceChecks: string[]; dependsOn: string[]; criterionIds: string[]; resourceKeys?: string[]; testPaths?: string[]; fixesChecks?: string[] }[]; testDirs?: string[] }
  team: { roles: { id: string; kind: 'producer' | 'reviewer'; responsibility: string; nodeIds: string[] }[] }
  executionPolicy: { model: string; maxAgents: number; maxAttemptsPerNode: number; maxDurationMinutes: number; maxExternalSpendMicros?: number; allowedEffects: string[]; materialChangeRule: string; mode?: 'normal' | 'auto'; capabilities?: OrcCapability[] }
  executionTarget: { kind: 'git_repository'; repositoryPath: string; baseCommit?: string; allowedPaths: string[]; requiredCheckIds?: string[] } | null
  sourceEvidence: { originalRequest: string; items: OrcEvidenceItem[]; coverage: { itemId: string; field: 'constraints' | 'exclusions' | 'criteria' | 'deliverables'; target: string }[] }
  openQuestions: string[]
  /** rules recommended with alternatives (gate 2): the owner sees the default and what else was considered */
  options?: { field: string; chosen: string; alternatives: string[]; why: string }[]
}
/** A tool or access beyond files and the shell that the work or its checks will use (a browser, a local server, a site,
 *  another app, credentials): approved at gate 2, exercised once at the start so any permission prompt comes while the
 *  owner is present. */
export type OrcCapability = { need: string; why: string; by: string; permission?: string }
export type OrcDecision = { at: number; gate: 'understanding' | 'permission' | 'continue'; choice: 'approve' | 'correct' | 'defer'; note?: string }
/** One item of the main-loop inbox: what the main session must know (wake) or do (spawn, notice); delivered through the
 *  tool-result door (mid-turn) or the prompt door (idle), acknowledged by evidence, redelivered until then. */
export type OrcInboxItem = {
  id: string
  kind: 'wake' | 'spawn' | 'notice'
  text: string
  at: number
  spawn?: { type: 'orc:verifier' | 'orc:verifier-web' | 'orc:integrator' | 'orc:orchestrator'; description: string; path: string }
  delivered: { at: number; via: 'tool-result' | 'tool-context' | 'prompt' }[]
  ackedAt?: number
  ackedBy?: string
}
export type OrcMission = {
  repo: string
  dir: string
  version: number
  status: 'drafting' | 'understanding_requested' | 'understood' | 'permission_requested' | 'approved' | 'running' | 'done'
  /** who orchestrates after permission: the main session (default, packet 2) or a spawned orc:orchestrator */
  mode?: 'main' | 'subagent'
  understanding?: OrcUnderstanding
  findings: string[]
  decisions: OrcDecision[]
  understandingApprovedAt?: number
  /** fingerprint of what gate 1 approved (mission + final picture): a gate-2 redraft that keeps it does not reopen gate 1 */
  gate1Digest?: string
  permissionApprovedAt?: number
  startedAt?: number
  missionFile?: string
  /** packet 3: durable projection of the ledger, written by the substrate while the mission runs */
  snapshot?: { at: number; cursor: number; children: { id: string; type: string; description: string; status: string; startedAt: number; endedAt?: number; mark?: string; markAt?: number; merged?: string; branch?: string; reportPath?: string; check?: string }[]; verifyRequests: { id: string; stage: 'checkpoint' | 'final' | 'integration'; at: number }[]; integrationRuns: { at: number; after: string; status: 'pass' | 'fail' | 'unavailable'; load?: number }[] }
  /** owner override of the plugin edit lock for this mission (/orc allow-edit); cleared at settle */
  editUnlocked?: boolean
  /** The orc computer: set by /orc computer on|off (the sandbox settings orc wrote for this repository). */
  computer?: { on: boolean; at: number; settingsPath: string }
  directives?: { at: number; text: string }[]
  backlog?: { id: string; request: string; at: number; status: 'queued' | 'started' | 'done' }[]
  /** /orc continue: the owner's follow-on requests; each starts version+1 under the approved rules, no new gates */
  continuations?: { at: number; version: number; request: string; previousFinal?: string }[]
  /** where the working rules were written at launch (the orchestrator brief points at it; it survives compaction) */
  rulesPath?: string
  /** lab options for a mission started from /orc demo or /orc start in main mode */
  lab?: { compactAt?: number; maxCompactions?: number; maxAgents?: number; example?: string; auto?: boolean }
  /** every compaction of the main session while the mission ran, with what the orchestrator did right after */
  compactions?: OrcCompaction[]
  /** proof that the orchestrator brief is in the system prompt: when it rendered, and the engine's own count of
   *  system-prompt tokens before the mission, after the brief, and after each compaction */
  brief?: { chars: number; renders: number[]; spBefore?: number; spAfter?: number; window?: number; windowSource?: string }
  /** auto mode: a Workbench brief run by the substrate (the runner), pinging the orchestrator only by its policy */
  graph?: OrcGraph
  /** 0.22.0: what the owner sees at done (the four lines: status · PROVED · READ · ledger), computed once at settle */
  outcome?: { at: number; version: number; status: string; reading?: string; lines: string[] }
  /** when this mission record was created (/orc begin, backlog next, continue, start): the intake's first instant */
  beganAt?: number
  /** the intake's cost (the main session's turns from beganAt to the launch of the orchestrator row), frozen at launch;
   *  absent when the launch predates this field or happened where the turns were not this session's */
  intake?: { requests: number; tokens: number; ms: number }
  updatedAt: number
}

/** One node of a graph run: its brief entry, where it stands, and the agents working on it. */
export type OrcGraphNode = {
  id: string
  role: string
  workType: string
  objective: string
  dependsOn: string[]
  status: 'pending' | 'building' | 'verifying' | 'retrying' | 'passed' | 'failed' | 'skipped'
  /** per_node: its own verifier before it merges; gates_only: merges on its check, a gate's verifier covers it */
  verifyMode?: 'per_node' | 'gates_only'
  attempts: number
  builderId?: string
  verifierId?: string
  lastFailure?: string
  startedAt?: number
  endedAt?: number
  /** the brief's own node object, kept whole for prompts */
  spec: Record<string, unknown>
}

/** A graph run (auto mode). The policy is data: the owner can change it mid-run; it applies to what has not started. */
export type OrcGraph = {
  briefPath: string
  goal: string
  status: 'running' | 'waiting' | 'done' | 'aborted'
  policy: { retryBudget: number; maxParallel: number; ping: 'every_node' | 'failures_only' | 'phase_end' }
  nodes: OrcGraphNode[]
  gates: { id: string; kind: string; after: string[]; reachedAt?: number }[]
  startedAt: number
  endedAt?: number
  pings: { at: number; text: string }[]
  preflight?: string
  /** the brief's criteria, id → text, so prompts carry the words and not only the ids */
  criteria?: Record<string, string>
  /** lab fault injection: the first verifier PASS of this run was turned into a defect (exercises the narrow re-verify path) */
  injected?: boolean
  /** integrators the runner itself spawned (first merge): only these are accepted silently; any other integrator wakes the orchestrator */
  runnerIntegrators?: string[]
}

/** One compaction of the main session during a main-mode mission: the state it hit and the recovery that followed. */
export type OrcCompaction = {
  at: number
  trigger: string
  ctxBefore?: number
  ctxAfter?: number
  /** the engine's count of system-prompt tokens at the first step after the compaction (the brief survives if it stays up) */
  systemPromptAfter?: number
  compactedAt?: number
  error?: string
  state: { running: string[]; unmarked: string[]; pendingVerification: string[] }
  orientId?: string
  statusCalledAt?: number
  after: { at: number; tool: string; what: string }[]
  spawns: { at: number; type: string; description: string; duplicateOf?: string }[]
}

/** `/orc demo`: the bundled example run, scored once when its final report is no longer PENDING. */
export type OrcDemo = { repo: string; exampleDir: string; finalPath: string; startedAt: number; name?: string; mode?: 'main' | 'subagent'; scored?: { at: number; passed: number; total: number; ok: boolean; tail: string } }

export type OrcEntry = {
  t: number
  kind: 'spawn' | 'tool' | 'turn' | 'send' | 'receive' | 'note'
  agentId?: string
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    orc: {
      turns: OrcTurn[]
      cur: OrcTurn | null
      agents: Record<string, OrcAgent>
      journal: OrcEntry[]
      isBandHidden: boolean
      tick: number
      demo: OrcDemo | null
      mission: OrcMission | null
      inbox: OrcInboxItem[]
    }
  }
}
