import type { ReactNode } from 'react'
import type { DepartmentId, HireState } from './teams'

export type View = 'onboarding' | 'home' | 'hq' | 'evolution' | 'assets' | 'timeline' | 'recovery' | 'studio'
export type OnboardingStep =
  | 'intent'
  | 'kind'
  | 'name'
  | 'offer'
  | 'audience'
  | 'deadline'
  | 'budget'
  | 'extra'
  | 'plan'
  | 'goal'
  | 'constraints'
export type StudioTab = 'Agents' | 'Prompts' | 'Tools' | 'Workflows' | 'Files' | 'Environment' | 'Permissions' | 'Logs' | 'VM' | 'Evaluations'
export type FileTier = 'Local Only' | 'Company Vault' | 'Shareable'
export type AgentState = 'busy' | 'idle'

export type Agent = {
  id: string
  name: string
  role: string
  state: AgentState
  doing: string
  why: string
  files: string
  tools: string
  outcome: string
  /** LiveHQ map still keys CSS layout off these four edges. Do not add more until a computed layout exists. */
  position: 'eng' | 'research' | 'design' | 'qa'
  /** 7-department model. Optional so the four synthetic LiveHQ agents stay valid. */
  team?: DepartmentId
  hired?: HireState
}

export type Experiment = {
  id: string
  label: string
  version: string
  metric: string
  confidence: string
  cost: string
  reliability: string
  decision: string
  note: string
}

export type Navigate = (view: View) => void

export type AppState = {
  view: View
  setView: Navigate
  started: boolean
  intent: string
  setIntent: (value: string) => void
  goal: string
  setGoal: (value: string) => void
  step: OnboardingStep
  setStep: (step: OnboardingStep) => void
  constraints: { audience: string; deadline: string; budget: string; assets: string }
  setConstraint: (key: 'audience' | 'deadline' | 'budget' | 'assets', value: string) => void
  selectedAgent: string | null
  setSelectedAgent: (id: string | null) => void
  selectedExperiment: string
  setSelectedExperiment: (id: string) => void
  approvalOpen: boolean
  setApprovalOpen: (open: boolean) => void
  studioTab: StudioTab
  setStudioTab: (tab: StudioTab) => void
}

export type RegionProps = { n?: string; label: string; children?: ReactNode; className?: string }
