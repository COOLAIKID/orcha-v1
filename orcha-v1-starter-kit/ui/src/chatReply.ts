export function replyTo(text: string) {
  const goal = text.replace(/\n+/g, ' ').trim() || 'this'
  const lower = goal.toLowerCase()
  const verb = lower.includes('automat')
    ? 'automate'
    : lower.includes('build')
      ? 'build'
      : 'create'
  return [
    `I can ${verb} a company around that.`,
    '',
    `Outcome: ${goal}`,
    '',
    'First useful slice in 7 days. One builder, one reviewer, no extra surface until that slice works.',
    '',
    'Who is it for, and what is the hard deadline?',
  ].join('\n')
}

/**
 * Keep an unreachable model from masquerading as a real answer. This is an
 * operational state, not a response to the user's prompt, so never echo the
 * prompt or wrap a canned answer in AI-looking copy.
 */
export function offlineReply(_text?: string) {
  return 'Cloud AI is unavailable right now, so Orcha did not generate an answer. Check the server provider configuration and try again.'
}

/**
 * Present legacy local history honestly without rewriting or deleting the
 * owner's stored chat. Older builds saved a canned response plus a prompt
 * echo when the model was unreachable; that content is operational state, not
 * an AI reply and must not remain reportable as one.
 */
export function presentReply(content: string) {
  if (content.startsWith('(Orcha could not reach its language model just now, so this is a built-in placeholder reply.)')) {
    return offlineReply()
  }
  return content
}
