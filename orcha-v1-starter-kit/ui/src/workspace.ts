export type StoredTool = {
  key: string
  label: string
  icon: 'file' | 'sliders' | 'repo' | 'plug' | 'grid' | 'agent'
  detail?: string
}

export type StoredMsg = {
  id: string
  role: 'user' | 'orcha'
  content: string
  kind?: 'steer'
  tools?: StoredTool[]
}

export type ChatThread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StoredMsg[]
}

export type Business = {
  id: string
  name: string
  brief: string
  createdAt: number
  chats: ChatThread[]
}

export type Account = {
  name: string
  email: string
  createdAt: number
  ageConfirmed: boolean
  acceptedLegalAt: number
}

export type SideMemory = {
  open: Record<string, boolean>
  others: boolean
  pane: 'chats' | 'tools'
  tool: 'agents'
}

export type Prefs = {
  language: 'auto' | 'en'
  motion: 'system' | 'reduce' | 'full'
  density: 'comfortable' | 'compact'
  submitOnEnter: boolean
  slashHints: boolean
  showTools: boolean
  customInstructions: string
  aboutYou: string
  saveHistory: boolean
  restoreLatest: boolean
  cloudAi: boolean
}

export type ContentReport = {
  id: string
  at: number
  reason: string
  excerpt: string
}

export type Workspace = {
  account: Account | null
  signedIn: boolean
  businesses: Business[]
  currentBusinessId: string | null
  currentChatId: string | null
  side: SideMemory
  prefs: Prefs
  reports: ContentReport[]
}

const KEY = 'orcha-workspace-v1'
const listeners = new Set<() => void>()

function readLegacyOthers() {
  try {
    return localStorage.getItem('orcha-side-biz') !== '0'
  } catch {
    return true
  }
}

function emptySide(): SideMemory {
  return { open: {}, others: readLegacyOthers(), pane: 'chats', tool: 'agents' }
}

export function emptyPrefs(): Prefs {
  return {
    language: 'auto',
    motion: 'system',
    density: 'comfortable',
    submitOnEnter: true,
    slashHints: true,
    showTools: true,
    customInstructions: '',
    aboutYou: '',
    saveHistory: true,
    restoreLatest: true,
    cloudAi: true,
  }
}

function readPrefs(raw: unknown): Prefs {
  const base = emptyPrefs()
  if (!raw || typeof raw !== 'object') return base
  const next = raw as Partial<Prefs>
  return {
    language: next.language === 'en' ? 'en' : 'auto',
    motion: next.motion === 'reduce' || next.motion === 'full' ? next.motion : 'system',
    density: next.density === 'compact' ? 'compact' : 'comfortable',
    submitOnEnter: next.submitOnEnter !== false,
    slashHints: next.slashHints !== false,
    showTools: next.showTools !== false,
    customInstructions: typeof next.customInstructions === 'string' ? next.customInstructions.slice(0, 1500) : '',
    aboutYou: typeof next.aboutYou === 'string' ? next.aboutYou.slice(0, 800) : '',
    saveHistory: next.saveHistory !== false,
    restoreLatest: next.restoreLatest !== false,
    cloudAi: next.cloudAi !== false,
  }
}

function empty(): Workspace {
  return { account: null, signedIn: false, businesses: [], currentBusinessId: null, currentChatId: null, side: emptySide(), prefs: emptyPrefs(), reports: [] }
}

function load(): Workspace {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<Workspace>
    if (!parsed || typeof parsed !== 'object') return empty()
    const side: SideMemory = parsed.side && typeof parsed.side === 'object'
      ? {
          open: parsed.side.open && typeof parsed.side.open === 'object' ? parsed.side.open : {},
          others: parsed.side.others !== false,
          pane: parsed.side.pane === 'tools' ? 'tools' : 'chats',
          tool: 'agents',
        }
      : emptySide()
    const accountRaw = parsed.account as { name?: string; email?: string; createdAt?: number; ageConfirmed?: boolean; acceptedLegalAt?: number } | null
    const account = accountRaw && typeof accountRaw === 'object'
      ? {
          name: String(accountRaw.name ?? ''),
          email: String(accountRaw.email ?? ''),
          createdAt: Number(accountRaw.createdAt) || Date.now(),
          ageConfirmed: accountRaw.ageConfirmed !== false,
          acceptedLegalAt: Number(accountRaw.acceptedLegalAt) || Number(accountRaw.createdAt) || 0,
        }
      : null
    return {
      account,
      signedIn: parsed.signedIn === true || (parsed.signedIn === undefined && Boolean(account)),
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses : [],
      currentBusinessId: parsed.currentBusinessId ?? null,
      currentChatId: parsed.currentChatId ?? null,
      side,
      prefs: readPrefs(parsed.prefs),
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    }
  } catch {
    return empty()
  }
}

let cache = load()

function applyChrome() {
  if (typeof document === 'undefined') return
  const prefs = cache.prefs
  document.documentElement.lang = prefs.language === 'en' ? 'en' : (navigator.language || 'en')
  document.documentElement.dataset.density = prefs.density
  document.documentElement.dataset.motion = prefs.motion
  document.documentElement.classList.toggle('is-reduce-motion', motionReduced())
}

function persist(open = false) {
  localStorage.setItem(KEY, JSON.stringify(cache))
  applyChrome()
  for (const listen of listeners) listen()
  if (open) window.dispatchEvent(new Event('orcha:open-thread'))
}

export function getWorkspace() {
  return cache
}

export function subscribeWorkspace(listen: () => void) {
  listeners.add(listen)
  return () => {
    listeners.delete(listen)
  }
}

export function currentBusiness() {
  return cache.businesses.find((item) => item.id === cache.currentBusinessId) ?? null
}

export function currentChat() {
  const business = currentBusiness()
  if (!business) return null
  return business.chats.find((item) => item.id === cache.currentChatId) ?? null
}

export function titleFrom(text: string) {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return 'New chat'
  return line.length > 36 ? `${line.slice(0, 35).trim()}…` : line
}

export function isSignedIn() {
  return Boolean(cache.signedIn && cache.account)
}

export function getPrefs() {
  return cache.prefs
}

export function updatePrefs(patch: Partial<Prefs>) {
  cache = { ...cache, prefs: readPrefs({ ...cache.prefs, ...patch }) }
  persist()
}

export function motionReduced() {
  if (typeof window === 'undefined') return false
  if (cache.prefs.motion === 'reduce') return true
  if (cache.prefs.motion === 'full') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function instructionBlock() {
  const prefs = cache.prefs
  return [
    prefs.aboutYou.trim() && `About the user: ${prefs.aboutYou.trim()}`,
    prefs.customInstructions.trim(),
  ].filter(Boolean).join('\n')
}

export function signUp(name: string, email: string) {
  cache = {
    ...cache,
    account: { name, email, createdAt: Date.now(), ageConfirmed: true, acceptedLegalAt: Date.now() },
    signedIn: true,
  }
  persist()
}

export function signIn(email: string) {
  const saved = cache.account
  if (!saved || saved.email.trim().toLowerCase() !== email.trim().toLowerCase()) return false
  const latest = [...cache.businesses].sort((left, right) => right.createdAt - left.createdAt)[0]
  const chat = latest ? [...latest.chats].sort((left, right) => right.updatedAt - left.updatedAt)[0] : null
  const restore = cache.prefs.restoreLatest
  cache = {
    ...cache,
    signedIn: true,
    currentBusinessId: restore ? latest?.id ?? null : null,
    currentChatId: restore ? chat?.id ?? null : null,
  }
  persist(Boolean(restore && chat))
  return true
}

export function updateAccount(name: string, email: string) {
  if (!isSignedIn()) return
  const createdAt = cache.account?.createdAt ?? Date.now()
  cache = {
    ...cache,
    account: {
      name,
      email,
      createdAt,
      ageConfirmed: cache.account?.ageConfirmed !== false,
      acceptedLegalAt: cache.account?.acceptedLegalAt || createdAt,
    },
  }
  persist()
}

export function signOut() {
  cache = {
    ...cache,
    signedIn: false,
    currentBusinessId: null,
    currentChatId: null,
  }
  persist()
  window.dispatchEvent(new Event('orcha:signed-out'))
}

export function startBusiness(name: string, brief: string) {
  const now = Date.now()
  const chat: ChatThread = {
    id: `c-${now}`,
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  const business: Business = {
    id: `b-${now}`,
    name,
    brief,
    createdAt: now,
    chats: [chat],
  }
  cache = {
    ...cache,
    businesses: [business, ...cache.businesses.filter((item) => item.id !== business.id)],
    currentBusinessId: business.id,
    currentChatId: chat.id,
    side: { ...cache.side, open: { ...cache.side.open, [business.id]: true } },
  }
  persist()
  return { business, chat }
}

export function newChat(open = false) {
  if (!isSignedIn()) return null
  const business = currentBusiness()
  if (!business) return null
  const now = Date.now()
  const chat: ChatThread = {
    id: `c-${now}`,
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  business.chats = [chat, ...business.chats]
  cache = { ...cache, currentChatId: chat.id, businesses: [...cache.businesses] }
  persist(open)
  return chat
}

export function writeMessages(messages: StoredMsg[], title?: string) {
  if (!isSignedIn() || !cache.prefs.saveHistory) return
  const business = currentBusiness()
  const chat = currentChat()
  if (!business || !chat) return
  chat.messages = messages
  chat.updatedAt = Date.now()
  if (title) chat.title = title
  cache = { ...cache, businesses: [...cache.businesses] }
  persist()
}

export function openChat(businessId: string, chatId: string) {
  if (!isSignedIn()) return
  const business = cache.businesses.find((item) => item.id === businessId)
  if (!business || !business.chats.some((item) => item.id === chatId)) return
  cache = { ...cache, currentBusinessId: businessId, currentChatId: chatId }
  persist(true)
}

export function openBusiness(businessId: string) {
  if (!isSignedIn()) return
  const business = cache.businesses.find((item) => item.id === businessId)
  if (!business) return
  const latest = [...business.chats].sort((left, right) => right.updatedAt - left.updatedAt)[0]
  cache = {
    ...cache,
    currentBusinessId: businessId,
    currentChatId: latest?.id ?? null,
  }
  persist(true)
}

export function chatsOf(business: Business | null) {
  if (!business) return []
  return [...business.chats].sort((left, right) => right.updatedAt - left.updatedAt)
}

export function otherBusinesses() {
  return cache.businesses
    .filter((item) => item.id !== cache.currentBusinessId)
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function listedBusinesses() {
  if (!isSignedIn()) return []
  const active = currentBusiness()
  return active ? [active, ...otherBusinesses()] : otherBusinesses()
}

export function workspaceStats() {
  return {
    businesses: cache.businesses.length,
    chats: cache.businesses.reduce((count, item) => count + item.chats.length, 0),
  }
}

export function isBusinessOpen(id: string) {
  if (id === cache.currentBusinessId) return cache.side.open[id] !== false
  return cache.side.open[id] === true
}

export function toggleBusinessOpen(id: string) {
  cache = {
    ...cache,
    side: { ...cache.side, open: { ...cache.side.open, [id]: !isBusinessOpen(id) } },
  }
  persist()
}

export function othersOpen() {
  return cache.side.others !== false
}

export function sidePane() {
  return cache.side.pane === 'tools' ? 'tools' : 'chats'
}

export function setSidePane(pane: 'chats' | 'tools') {
  cache = { ...cache, side: { ...cache.side, pane } }
  persist()
}

export function setToolTab(tool: 'agents') {
  cache = { ...cache, side: { ...cache.side, tool } }
  persist()
}

export function toggleOthersOpen() {
  cache = {
    ...cache,
    side: { ...cache.side, others: !othersOpen() },
  }
  persist()
}

export function clearAllChats() {
  cache = {
    ...cache,
    businesses: cache.businesses.map((business) => ({
      ...business,
      chats: business.chats.map((chat) => ({ ...chat, messages: [], title: 'New chat', updatedAt: Date.now() })),
    })),
  }
  persist(true)
}

export function deleteAccount() {
  cache = empty()
  persist()
  window.dispatchEvent(new Event('orcha:signed-out'))
}

export function addReport(reason: string, excerpt: string) {
  const item: ContentReport = {
    id: `r-${Date.now()}`,
    at: Date.now(),
    reason,
    excerpt: excerpt.slice(0, 400),
  }
  cache = { ...cache, reports: [item, ...cache.reports].slice(0, 50) }
  persist()
  return item
}

export function exportWorkspace() {
  const blob = new Blob([JSON.stringify(cache, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = 'orcha-workspace.json'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

if (typeof window !== 'undefined') {
  applyChrome()
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyChrome)
}
