export type CardItem = { id: string; title: string }
export type CardPage = {
  id: string
  kind: 'cards'
  title: string
  items: CardItem[]
  placeholder: string
}
export type AskPage = { id: string; kind: 'ask'; title: string; placeholder: string; required?: boolean }
export type PlanPage = { id: string; kind: 'plan'; title: string }
export type Page = CardPage | AskPage | PlanPage

export const SHAPES: CardItem[] = [
  { id: 'mobile', title: 'Mobile app' },
  { id: 'desktop', title: 'Desktop app' },
  { id: 'web', title: 'Web app' },
  { id: 'ai', title: 'AI' },
  { id: 'content', title: 'Content' },
  { id: 'store', title: 'Store' },
  { id: 'other', title: 'Other' },
]

const TITLE: Record<string, string> = Object.fromEntries(SHAPES.map((item) => [item.id, item.title]))

const FOLLOWS: Record<string, { ask: (rest: string) => string; items: CardItem[]; placeholder: string }> = {
  mobile: {
    ask: (rest) => (rest ? `Phones for the ${rest}?` : 'Which phones?'),
    placeholder: 'Which phones?',
    items: [
      { id: 'ios', title: 'iPhone' },
      { id: 'android', title: 'Android' },
      { id: 'ipad', title: 'iPad' },
      { id: 'watch', title: 'Watch' },
      { id: 'fold', title: 'Foldable' },
      { id: 'other', title: 'Other' },
    ],
  },
  desktop: {
    ask: (rest) => (rest ? `Computers for the ${rest}?` : 'Which computers?'),
    placeholder: 'Which computers?',
    items: [
      { id: 'mac', title: 'Mac' },
      { id: 'windows', title: 'Windows' },
      { id: 'linux', title: 'Linux' },
      { id: 'all-desk', title: 'All of them' },
      { id: 'kiosk', title: 'Kiosk' },
      { id: 'other', title: 'Other' },
    ],
  },
  web: {
    ask: (rest) => (rest ? `What kind of web for the ${rest}?` : 'What kind of web?'),
    placeholder: 'What kind of web?',
    items: [
      { id: 'saas', title: 'SaaS' },
      { id: 'site', title: 'Website' },
      { id: 'extension', title: 'Extension' },
      { id: 'api', title: 'API' },
      { id: 'dashboard', title: 'Dashboard' },
      { id: 'other', title: 'Other' },
    ],
  },
  ai: {
    ask: (rest) => (rest ? `What does the AI do in the ${rest}?` : 'What does the AI do?'),
    placeholder: 'What does it do?',
    items: [
      { id: 'chat', title: 'Chat' },
      { id: 'write', title: 'Write' },
      { id: 'code', title: 'Code' },
      { id: 'image', title: 'Image' },
      { id: 'automate', title: 'Automate' },
      { id: 'other', title: 'Other' },
    ],
  },
  content: {
    ask: (rest) => (rest ? `What content for the ${rest}?` : 'What content?'),
    placeholder: 'What content?',
    items: [
      { id: 'newsletter', title: 'Newsletter' },
      { id: 'blog', title: 'Blog' },
      { id: 'video', title: 'Video' },
      { id: 'social', title: 'Social' },
      { id: 'course', title: 'Course' },
      { id: 'other', title: 'Other' },
    ],
  },
  store: {
    ask: (rest) => (rest ? `What does the ${rest} sell?` : 'What do you sell?'),
    placeholder: 'What do you sell?',
    items: [
      { id: 'files', title: 'Files' },
      { id: 'templates', title: 'Templates' },
      { id: 'subs', title: 'Subscriptions' },
      { id: 'seats', title: 'Seats' },
      { id: 'ads', title: 'Ads' },
      { id: 'other', title: 'Other' },
    ],
  },
}

export function labelOf(ids: string[]) {
  const titles = ids.map((id) => TITLE[id] ?? id).filter(Boolean)
  if (titles.length === 0) return 'product'
  if (titles.length === 1) return titles[0]
  if (titles.length === 2) return `${titles[0]} + ${titles[1]}`
  return `${titles.slice(0, -1).join(', ')} + ${titles[titles.length - 1]}`
}

function restLabel(picks: string[], self: string) {
  return labelOf(picks.filter((id) => id !== self))
}

export function buildPath(picks: string[]): Page[] {
  const chosen = SHAPES.map((item) => item.id).filter((id) => picks.includes(id))
  const follows = chosen.flatMap((id) => {
    const follow = FOLLOWS[id]
    if (!follow) return []
    const rest = restLabel(chosen, id)
    return [{
      id: `follow-${id}`,
      kind: 'cards' as const,
      title: follow.ask(rest === 'product' ? '' : rest),
      items: follow.items,
      placeholder: follow.placeholder,
    }]
  })
  const noun = labelOf(chosen)
  return [
    { id: 'shape', kind: 'cards', title: 'What is it?', items: SHAPES, placeholder: 'What is it?' },
    ...follows,
    { id: 'name', kind: 'ask', title: chosen.includes('ai') ? 'Name the AI?' : 'Name?', placeholder: 'Optional' },
    {
      id: 'offer',
      kind: 'ask',
      title: chosen.includes('store') ? `What does the ${noun} sell?` : `What does the ${noun} do?`,
      placeholder: chosen.includes('ai') ? 'Drafts replies from a user’s inbox' : 'Weekly client updates from notes',
      required: true,
    },
    { id: 'audience', kind: 'ask', title: `Who pays for the ${noun}?`, placeholder: 'Freelance designers' },
    { id: 'deadline', kind: 'ask', title: `Ship the ${noun} by when?`, placeholder: '14 days' },
    { id: 'budget', kind: 'ask', title: 'Daily budget?', placeholder: '$25' },
    { id: 'extra', kind: 'ask', title: 'Anything else?', placeholder: 'A domain, a repo, or skip' },
    { id: 'plan', kind: 'plan', title: 'Ready to run.' },
  ]
}

export function teamFrom(picks: string[]) {
  const roles = new Set<string>()
  if (picks.some((id) => id === 'mobile' || id === 'desktop' || id === 'web')) {
    roles.add('Build')
    roles.add('Design')
    roles.add('QA')
  }
  if (picks.includes('ai')) {
    roles.add('Model')
    roles.add('Build')
    roles.add('QA')
  }
  if (picks.includes('content')) {
    roles.add('Write')
    roles.add('Research')
    roles.add('Publish')
  }
  if (picks.includes('store')) {
    roles.add('Catalog')
    roles.add('Write')
    roles.add('Fulfillment')
  }
  if (roles.size === 0) {
    roles.add('Build')
    roles.add('Research')
    roles.add('Write')
  }
  return [...roles].slice(0, 4)
}
