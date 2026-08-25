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
 * Wraps a built-in placeholder so an unreachable model never masquerades as a
 * real answer — silence followed by canned text is what reads as "chat is
 * broken". Synthetic content stays clearly labeled synthetic.
 */
export function offlineReply(text: string) {
  return [
    '(Orcha could not reach its language model just now, so this is a built-in placeholder reply.)',
    '',
    text,
  ].join('\n')
}
