import type { Agent, Experiment, FileTier, StudioTab } from './types'

export const INTENTS = [
  { id: 'software', title: 'Software', detail: 'A web product Orcha can build and run itself.', ask: 'What type of software?' },
  { id: 'content', title: 'Content', detail: 'Sites, newsletters, and media written and shipped online.', ask: 'What type of content?' },
  { id: 'commerce', title: 'Digital store', detail: 'Sell files, templates, or downloads with no warehouse.', ask: 'What do you sell?' },
  { id: 'growth', title: 'Growth', detail: 'SEO, ads, and campaigns that stay on a computer.', ask: 'What type of growth?' },
  { id: 'support', title: 'Support', detail: 'Chat, docs, and onboarding with no storefront.', ask: 'What type of support?' },
  { id: 'other', title: 'Other', detail: 'Something else Orcha can run entirely online.', ask: 'What is it?' },
]

export const KINDS: Record<string, { id: string; title: string; detail: string }[]> = {
  software: [
    { id: 'web', title: 'Web app', detail: 'A product people use in the browser.' },
    { id: 'saas', title: 'SaaS', detail: 'A subscription tool teams pay for online.' },
    { id: 'extension', title: 'Browser extension', detail: 'A tool that lives in the browser.' },
    { id: 'api', title: 'API', detail: 'A service other software calls.' },
    { id: 'bot', title: 'Bot', detail: 'A chat or agent people talk to online.' },
    { id: 'other', title: 'Other', detail: 'A different online product. Say what it is.' },
  ],
  content: [
    { id: 'blog', title: 'Blog', detail: 'Articles Orcha writes and publishes.' },
    { id: 'newsletter', title: 'Newsletter', detail: 'An email people subscribe to.' },
    { id: 'seo', title: 'SEO site', detail: 'Pages built to rank and get visits.' },
    { id: 'social', title: 'Social', detail: 'Posts and threads shipped on a schedule.' },
    { id: 'course', title: 'Course', detail: 'Lessons sold and delivered online.' },
    { id: 'other', title: 'Other', detail: 'A different content business. Say what it is.' },
  ],
  commerce: [
    { id: 'templates', title: 'Templates', detail: 'Ready files people download and use.' },
    { id: 'downloads', title: 'Digital downloads', detail: 'Ebooks, packs, or assets sold as files.' },
    { id: 'plugins', title: 'Plugins', detail: 'Add-ons for sites and tools.' },
    { id: 'kits', title: 'Kits', detail: 'Bundled prompts, docs, or Notion setups.' },
    { id: 'stock', title: 'Stock assets', detail: 'Icons, copy, or components sold online.' },
    { id: 'other', title: 'Other', detail: 'A different digital product. Say what it is.' },
  ],
  growth: [
    { id: 'seo-growth', title: 'SEO', detail: 'Pages and links that earn search traffic.' },
    { id: 'ads', title: 'Paid ads', detail: 'Campaigns written and adjusted online.' },
    { id: 'email', title: 'Email', detail: 'Sequences that run themselves.' },
    { id: 'landing', title: 'Landing pages', detail: 'Pages built to convert a visit.' },
    { id: 'affiliate', title: 'Affiliate', detail: 'Reviews and links that earn a cut.' },
    { id: 'other', title: 'Other', detail: 'A different growth motion. Say what it is.' },
  ],
  support: [
    { id: 'chatbot', title: 'Chatbot', detail: 'Answers questions in a chat window.' },
    { id: 'help', title: 'Help center', detail: 'Articles that deflect tickets.' },
    { id: 'onboard', title: 'Onboarding', detail: 'Guides that get a user to first value.' },
    { id: 'faq', title: 'FAQ', detail: 'A short set of answers that stay current.' },
    { id: 'tickets', title: 'Ticket triage', detail: 'Sort and draft replies to inbound mail.' },
    { id: 'other', title: 'Other', detail: 'A different support product. Say what it is.' },
  ],
  other: [
    { id: 'other', title: 'Other', detail: 'Name the online work in your own words.' },
  ],
}

export const AGENTS: Agent[] = [
  { id: 'eng', name: 'Engineering', role: 'Build systems', state: 'busy', doing: 'Implement upload flow', why: 'Next unblocked move toward first useful slice', files: '2 files changed', tools: 'repo.write · shell.test', outcome: 'Preview build 0.3.1', position: 'eng' },
  { id: 'research', name: 'Research', role: 'Find signal', state: 'busy', doing: 'Map competitor onboarding', why: 'Users abandon setup when the next step is unclear', files: 'synthesis.md', tools: 'web.search (granted)', outcome: '18 source notes', position: 'research' },
  { id: 'design', name: 'Design', role: 'Shape the experience', state: 'busy', doing: 'Create onboarding variants', why: 'Need a clearer first-run promise', files: 'onboarding-brief.md', tools: 'preview.deploy', outcome: 'Variant A proposed', position: 'design' },
  { id: 'qa', name: 'QA', role: 'Protect the outcome', state: 'idle', doing: 'Waiting on a build to verify', why: 'No unblocked acceptance work', files: 'none this cycle', tools: 'none', outcome: 'Idle — not theatrically busy', position: 'qa' },
]

export const AWAY_EVENTS = [
  { id: 'evt-18', kind: 'Shipped preview', time: '2m ago', title: 'Preview deployed', body: 'Engineering published build 0.3.1 to the company preview.', agent: 'Engineering' },
  { id: 'evt-17', kind: 'Experiment decided', time: '11m ago', title: 'New experiment started', body: 'Design is testing a clearer first-run promise against the baseline.', agent: 'Design' },
  { id: 'evt-16', kind: 'Completed task', time: '24m ago', title: 'Signal added to memory', body: 'Research found that users abandon setup when the next step is unclear.', agent: 'Research' },
  { id: 'evt-15', kind: 'Failure repaired', time: '41m ago', title: 'Build recovered', body: 'A dependency mismatch was repaired and the test suite is green.', agent: 'Orchestrator' },
  { id: 'evt-14', kind: 'New question', time: '1h ago', title: 'Needs a capability grant', body: 'Research asked to enable one additional document source.', agent: 'Research' },
  { id: 'evt-13', kind: 'Next action', time: '1h ago', title: 'QA unblocked after recover', body: 'Acceptance suite can run once the next preview lands.', agent: 'QA' },
]

export const EXPERIMENTS: Experiment[] = [
  { id: 'baseline', label: 'Baseline', version: 'v0.2', metric: '3.8% completion', confidence: 'Measured · 3h window', cost: '$0.84 / 100 sessions', reliability: '99.1% healthy', decision: 'Keep as rollback target', note: 'Current production candidate.' },
  { id: 'variant-a', label: 'Variant A', version: 'v0.3', metric: '4.6% completion', confidence: 'Measured · 3h window', cost: '$0.91 / 100 sessions', reliability: '99.4% healthy', decision: 'Recommend promote', note: 'Clearer outcome language and one fewer setup step.' },
  { id: 'variant-b', label: 'Variant B', version: 'v0.3b', metric: '3.1% completion', confidence: 'Measured · retired', cost: '$0.89 / 100 sessions', reliability: '98.2% healthy', decision: 'Retired', note: 'More visual, but introduced a reliability regression.' },
]

export const ASSETS: { name: string; tier: FileTier; updated: string; status: string }[] = [
  { name: 'Preview build 0.3.1', tier: 'Shareable', updated: '2m ago', status: 'Healthy' },
  { name: 'Research synthesis · 18 sources', tier: 'Company Vault', updated: 'today', status: 'Stored' },
  { name: 'Onboarding experiment brief', tier: 'Company Vault', updated: 'today', status: 'Stored' },
  { name: 'Owner notes.docx', tier: 'Local Only', updated: 'yesterday', status: 'Not readable by VM agents' },
  { name: 'Company memory · 42 entries', tier: 'Company Vault', updated: 'today', status: 'Stored' },
]

export const STUDIO_TABS: StudioTab[] = ['Agents', 'Prompts', 'Tools', 'Workflows', 'Files', 'Environment', 'Permissions', 'Logs', 'VM', 'Evaluations']

export const RECOVERY_STEPS = [
  { t: 'T+0', title: 'Failure recorded', body: 'Build 0.3.0 failed: dependency mismatch in lockfile. Event evt-12.' },
  { t: 'T+4m', title: 'Diagnosis', body: 'Orchestrator compared last green build and isolated a transitive version pin.' },
  { t: 'T+11m', title: 'Repair attempt', body: 'Engineering regenerated the lockfile and reran the acceptance suite.' },
  { t: 'T+18m', title: 'Retry succeeded', body: 'Preview 0.3.1 is healthy. Rollback target remains 0.2.' },
]
