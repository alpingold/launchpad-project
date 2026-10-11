// Small wrappers around sessionStorage (decision D5).
//
// sessionStorage survives a page refresh but belongs to one tab, and is cleared when the
// tab closes. That's exactly the lifetime of "my spot in this room". Every call is wrapped
// in try/catch because some browsers (private modes, strict settings) throw on access;
// the app then still works, it just can't resume after a refresh.

export function loadSession(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: resume won't work, nothing else breaks.
  }
}

export function clearSession(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}
