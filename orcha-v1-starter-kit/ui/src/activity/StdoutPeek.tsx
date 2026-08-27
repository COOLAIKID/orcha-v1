import { useState } from 'react'

const PREVIEW_LINES = 6

export function StdoutPeek({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const rows = text.replace(/\s+$/, '').split('\n')
  const collapsed = rows.length > PREVIEW_LINES || text.length > 360
  const shown = open || !collapsed ? text : rows.slice(0, PREVIEW_LINES).join('\n')
  return (
    <div className="work-term">
      <pre>{shown}</pre>
      {collapsed && (
        <button type="button" className="work-term-more" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide output' : 'Show full output'}
        </button>
      )}
    </div>
  )
}
