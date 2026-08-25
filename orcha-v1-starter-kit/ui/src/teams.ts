// Department / specialist model for the AI business starter.
//
// Additive on purpose: the original four-agent `Agent` type in types.ts and the
// `AGENTS` array in data.ts are still what LiveHQ and Studio render. Nothing here
// replaces them. When the computed map layout lands, LiveHQ can move onto this
// model and the old one can retire.
//
// All content below is SYNTHETIC prototype data.

export type DepartmentId =
  | 'product' | 'engineering' | 'quality' | 'design' | 'growth' | 'data' | 'business'

/** Whether the company has this specialist yet. Agents are hired over time. */
export type HireState = 'hired' | 'proposed' | 'available'

/** What a hired specialist is doing right now. Unhired specialists are always 'idle'. */
export type WorkState = 'working' | 'idle' | 'blocked' | 'needs-you'

export type Department = {
  id: DepartmentId
  /** Consumer-facing name. Plain language, no jargon. */
  name: string
  /** One line a non-technical owner understands. */
  blurb: string
  /** DESIGN.md color role. */
  tint: string
}

export type Specialist = {
  id: string
  name: string
  department: DepartmentId
  hire: HireState
  state: WorkState
  /** Plain sentence, safe to show a consumer. Empty when not hired. */
  doing: string
}

export const DEPARTMENTS: Department[] = [
  { id: 'product', name: 'Product', blurb: 'Decides what to build next', tint: '#9B8CFF' },
  { id: 'engineering', name: 'Engineering', blurb: 'Builds and ships it', tint: '#6FA8E9' },
  { id: 'quality', name: 'Quality', blurb: 'Checks it works before you see it', tint: '#62D9B1' },
  { id: 'design', name: 'Design', blurb: 'Makes it clear and good-looking', tint: '#EAB365' },
  { id: 'growth', name: 'Growth', blurb: 'Finds people and brings them in', tint: '#EF7D83' },
  { id: 'data', name: 'Data', blurb: 'Measures what actually worked', tint: '#8D96A8' },
  { id: 'business', name: 'Business', blurb: 'Pricing, competitors, paperwork', tint: '#EDF0F5' },
]

export const SPECIALISTS: Specialist[] = [
  // Product
  { id: 'pm', name: 'Product Manager', department: 'product', hire: 'hired', state: 'working', doing: 'Choosing the first thing to build' },
  { id: 'researcher', name: 'Researcher', department: 'product', hire: 'hired', state: 'working', doing: 'Reading what competitors do at signup' },
  { id: 'interviewer', name: 'User Interviewer', department: 'product', hire: 'available', state: 'idle', doing: '' },
  { id: 'spec', name: 'Spec Writer', department: 'product', hire: 'available', state: 'idle', doing: '' },

  // Engineering
  { id: 'backend', name: 'Backend', department: 'engineering', hire: 'hired', state: 'working', doing: 'Building the upload flow' },
  { id: 'frontend', name: 'Frontend', department: 'engineering', hire: 'hired', state: 'working', doing: 'Building the first screen' },
  { id: 'mobile', name: 'Mobile', department: 'engineering', hire: 'available', state: 'idle', doing: '' },
  { id: 'database', name: 'Database', department: 'engineering', hire: 'proposed', state: 'idle', doing: '' },
  { id: 'devops', name: 'DevOps', department: 'engineering', hire: 'available', state: 'idle', doing: '' },
  { id: 'integrations', name: 'Integrations', department: 'engineering', hire: 'available', state: 'idle', doing: '' },

  // Quality
  { id: 'reviewer', name: 'Code Reviewer', department: 'quality', hire: 'hired', state: 'working', doing: 'Reviewing the upload flow' },
  { id: 'qa', name: 'QA', department: 'quality', hire: 'hired', state: 'idle', doing: 'Waiting for a build to test' },
  { id: 'security', name: 'Security Auditor', department: 'quality', hire: 'proposed', state: 'idle', doing: '' },
  { id: 'a11y', name: 'Accessibility Auditor', department: 'quality', hire: 'available', state: 'idle', doing: '' },
  { id: 'perf', name: 'Performance', department: 'quality', hire: 'available', state: 'idle', doing: '' },

  // Design
  { id: 'ux', name: 'UX', department: 'design', hire: 'hired', state: 'working', doing: 'Testing a clearer first screen' },
  { id: 'ui', name: 'UI / Visual', department: 'design', hire: 'hired', state: 'idle', doing: 'Waiting on the UX decision' },
  { id: 'brand', name: 'Brand', department: 'design', hire: 'available', state: 'idle', doing: '' },
  { id: 'copy', name: 'Copywriter', department: 'design', hire: 'available', state: 'idle', doing: '' },

  // Growth
  { id: 'ads', name: 'Ads', department: 'growth', hire: 'hired', state: 'working', doing: 'Testing two ad headlines' },
  { id: 'seo', name: 'SEO', department: 'growth', hire: 'available', state: 'idle', doing: '' },
  { id: 'content', name: 'Content', department: 'growth', hire: 'available', state: 'idle', doing: '' },
  { id: 'social', name: 'Social', department: 'growth', hire: 'available', state: 'idle', doing: '' },
  { id: 'email', name: 'Email', department: 'growth', hire: 'available', state: 'idle', doing: '' },
  { id: 'landing', name: 'Landing Page', department: 'growth', hire: 'proposed', state: 'idle', doing: '' },

  // Data
  { id: 'abtest', name: 'A/B Tester', department: 'data', hire: 'hired', state: 'working', doing: 'Measuring which headline wins' },
  { id: 'analytics', name: 'Analytics', department: 'data', hire: 'available', state: 'idle', doing: '' },
  { id: 'reporting', name: 'Reporting', department: 'data', hire: 'available', state: 'idle', doing: '' },

  // Business
  { id: 'pricing', name: 'Pricing', department: 'business', hire: 'available', state: 'idle', doing: '' },
  { id: 'competitor', name: 'Competitor Analyst', department: 'business', hire: 'available', state: 'idle', doing: '' },
  { id: 'legal', name: 'Legal', department: 'business', hire: 'proposed', state: 'idle', doing: '' },
  { id: 'support', name: 'Support', department: 'business', hire: 'available', state: 'idle', doing: '' },
]

export function membersOf(department: DepartmentId, roster: Specialist[] = SPECIALISTS): Specialist[] {
  return roster.filter((person) => person.department === department)
}

export function hiredIn(department: DepartmentId, roster: Specialist[] = SPECIALISTS): Specialist[] {
  return membersOf(department, roster).filter((person) => person.hire === 'hired')
}

export type DepartmentStatus = {
  tone: 'working' | 'waiting' | 'attention' | 'empty'
  line: string
}

/**
 * START_HERE / PRODUCT name for a department plus the people in it.
 * Status is derived from hired members — the consumer never lists specialists.
 */
export type Team = Department & {
  members: Specialist[]
  status: DepartmentStatus
}

/**
 * Department status derived from its members — the consumer never sees individual
 * specialists, so the department has to speak for itself in one sentence.
 */
export function departmentStatus(department: DepartmentId, roster: Specialist[] = SPECIALISTS): DepartmentStatus {
  const hired = hiredIn(department, roster)
  if (hired.length === 0) return { tone: 'empty', line: 'Not hired yet' }

  const attention = hired.find((person) => person.state === 'needs-you' || person.state === 'blocked')
  if (attention) return { tone: 'attention', line: attention.doing || 'Needs a decision from you' }

  const working = hired.filter((person) => person.state === 'working')
  if (working.length === 0) return { tone: 'waiting', line: 'Waiting on other work' }
  if (working.length === 1) return { tone: 'working', line: working[0].doing }
  return { tone: 'working', line: `${working[0].doing}, +${working.length - 1} more` }
}

export function hiredCount(roster: Specialist[] = SPECIALISTS): number {
  return roster.filter((person) => person.hire === 'hired').length
}

export function proposedCount(roster: Specialist[] = SPECIALISTS): number {
  return roster.filter((person) => person.hire === 'proposed').length
}

export function teamOf(id: DepartmentId, roster: Specialist[] = SPECIALISTS): Team {
  const department = DEPARTMENTS.find((entry) => entry.id === id)
  if (!department) throw new Error(`Unknown department: ${id}`)
  return {
    ...department,
    members: membersOf(id, roster),
    status: departmentStatus(id, roster),
  }
}

export function allTeams(roster: Specialist[] = SPECIALISTS): Team[] {
  return DEPARTMENTS.map((department) => teamOf(department.id, roster))
}

/** Agent.team membership. `department` on Specialist is the same field. */
export function teamOfPerson(person: Specialist): DepartmentId {
  return person.department
}

/** Agent.hired state. Unhired specialists are proposed or available. */
export function hiredState(person: Specialist): HireState {
  return person.hire
}
