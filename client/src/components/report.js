/** The report form (plan §31c), remembering which page it was opened from. */
export function reportHref() {
  const from = window.location.pathname;
  return from === '/' ? '/report' : `/report?from=${encodeURIComponent(from)}`;
}
