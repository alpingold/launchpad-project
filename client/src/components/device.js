/**
 * The device and browser, in a few words ("iPhone · Safari"), sent with a report (plan §31):
 * many bugs only happen on one kind of phone. Worked out from the browser's own description of
 * itself (the user agent), which is a guess, but a good one.
 * @param {string} [ua]
 * @param {number} [touchPoints]
 */
export function describeDevice(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0) {
  let device = 'Unknown device';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) device = 'iPad'; // iPads say they're Macs
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Windows/.test(ua)) device = 'Windows';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/Linux/.test(ua)) device = 'Linux';

  // Order matters: Edge and Samsung's browser also say "Chrome", and Chrome also says "Safari".
  let browser = 'another browser';
  if (/Edg(A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return `${device} · ${browser}`;
}
