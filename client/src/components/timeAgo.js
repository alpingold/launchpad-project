/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date ("Oct 3"). */
export function timeAgo(ms, now = Date.now()) {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
