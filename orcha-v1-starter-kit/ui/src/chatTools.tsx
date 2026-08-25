export const CHAT_TOOLS = [
  { id: 'files', label: 'Files', icon: 'file', hint: 'Attach files to this chat' },
  { id: 'constraints', label: 'Constraints', icon: 'sliders', hint: 'Add a limit Orcha should keep' },
  { id: 'repo', label: 'Repo', icon: 'repo', hint: 'Point at a repository' },
  { id: 'tool', label: 'Tool', icon: 'plug', hint: 'Connect an external tool' },
  { id: 'template', label: 'Template', icon: 'grid', hint: 'Start from a template' },
  { id: 'agent', label: 'Agent', icon: 'agent', hint: 'Bring in a specialist' },
] as const

export type ChatTool = (typeof CHAT_TOOLS)[number]
export type ChatToolId = ChatTool['id']
export type ChatToolIcon = ChatTool['icon']

export function ToolGlyph({ name }: { name: ChatToolIcon }) {
  if (name === 'file') {
    return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 2.5L17.5 8H14zM8 12h8v1.6H8zm0 3.2h8v1.6H8z" /></svg>
  }
  if (name === 'sliders') {
    return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 6h9V4.4H4zm13 0h3V4.4h-3zM11 13h9v-1.6h-9zM4 13h4v-1.6H4zm8 7h8v-1.6h-8zM4 20h5v-1.6H4zM14.2 7.8a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zM9.8 13.8a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zM12.2 20.8a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z" /></svg>
  }
  if (name === 'repo') {
    return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 3.5A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10V19H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h10V3.5zm4.2 5.2 3.3 3.3-3.3 3.3 1.1 1.1 4.4-4.4-4.4-4.4z" /></svg>
  }
  if (name === 'plug') {
    return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 2h1.6v5H8zm6.4 0H16v5h-1.6zM7 8.5h10v3.2c0 3.1-1.9 5.2-4.2 5.8V22h-1.6v-4.5C8.9 16.9 7 14.8 7 11.7zm1.6 1.6v1.6c0 2.1 1.2 3.5 3.4 3.5s3.4-1.4 3.4-3.5V10.1z" /></svg>
  }
  if (name === 'grid') {
    return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z" /></svg>
  }
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 9.5c3.7 0 8 1.8 8 4.2V20H4v-2.3c0-2.4 4.3-4.2 8-4.2z" /></svg>
}
