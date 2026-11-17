/**
 * What a page keeps in localStorage to carry on after a reload. Every read and write is guarded:
 * storage can be full, switched off or blocked (a private window), and a page must work without it.
 */
export function load<T>(key: string): T | undefined {
  try {
    const text = localStorage.getItem(key);
    return text === null ? undefined : (JSON.parse(text) as T);
  } catch {
    return undefined;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked: a reload won't carry on, but the page goes on working.
  }
}

export function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
