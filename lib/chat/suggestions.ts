/**
 * The six suggested questions, one per scenario in the brief.
 *
 * Shared between the UI chips and the STATIC tier's tests rather than duplicated,
 * because the invariant that matters is that every chip a reviewer can click has
 * a canned answer -- including when the budget is gone and there is no model to
 * cover a miss. Duplicating the strings would let that invariant rot silently.
 */
export const SUGGESTIONS = [
  'What does Cadre AI do?',
  'Do you work with my industry?',
  'How do I book a call?',
  'What is the AI Maturity Index?',
  'How do I access the client portal?',
  'How does Cadre approach data security?',
] as const
