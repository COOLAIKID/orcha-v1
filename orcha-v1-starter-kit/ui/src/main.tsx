import { Component, StrictMode, useState, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from './components/Shell'
import './styles.css'
import type { AppState, OnboardingStep, StudioTab, View } from './types'
import { ChatEntry } from './views/ChatEntry'
import { LegalPage } from './views/LegalDoc'
import { Teams } from './views/Teams'
import { LogoCreate } from './views/LogoCreate'

class LoadError extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || 'The chat surface failed to load.' }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(error)
  }

  render() {
    if (!this.state.message) return this.props.children
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#212121', color: '#ececec', fontFamily: 'DM Sans, sans-serif' }}>
        <p style={{ margin: 0, maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>{this.state.message} Refresh the page. If it stays blank, hard-refresh http://127.0.0.1:5175/</p>
      </main>
    )
  }
}

function App() {
  const [view, setView] = useState<View>('onboarding')
  const [started, setStarted] = useState(false)
  const [intent, setIntent] = useState('')
  const [goal, setGoal] = useState('')
  const [step, setStep] = useState<OnboardingStep>('intent')
  const [constraints, setConstraints] = useState({ audience: 'University students', deadline: '7 days to first preview', budget: '$25 / day', assets: 'Syllabus PDF (local only)' })
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedExperiment, setSelectedExperiment] = useState('variant-a')
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [studioTab, setStudioTab] = useState<StudioTab>('Agents')

  const go: AppState['setView'] = () => {
    setView('onboarding')
  }

  const state: AppState = {
    view,
    setView: go,
    started,
    intent,
    setIntent,
    goal,
    setGoal,
    step,
    setStep,
    constraints,
    setConstraint: (key, value) => setConstraints((current) => ({ ...current, [key]: value })),
    selectedAgent,
    setSelectedAgent,
    selectedExperiment,
    setSelectedExperiment,
    approvalOpen,
    setApprovalOpen,
    studioTab,
    setStudioTab,
  }

  const path = window.location.pathname.replace(/\/$/, '')

  if (path === '/create') return <LogoCreate />
  if (path === '/teams') return <Teams />
  if (path === '/privacy') return <LegalPage id="privacy" />
  if (path === '/terms') return <LegalPage id="terms" />
  if (path === '/delete-account') return <LegalPage id="delete" />

  return (
    <Shell state={state}>
      <ChatEntry state={state} />
    </Shell>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><LoadError><App /></LoadError></StrictMode>)
