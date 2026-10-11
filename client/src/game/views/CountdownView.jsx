import { useEffect, useState } from 'react';

/**
 * { view: 'countdown', title, endsAt }: counts down to endsAt (a server timestamp in ms).
 *
 * Phones' clocks are often a few seconds off. clockOffset (server time minus this device's
 * time, measured when the message arrived) corrects for that, so every screen shows the
 * same number at the same moment.
 */
export default function CountdownView({ view, clockOffset = 0 }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((view.endsAt - (now + clockOffset)) / 1000));
  return (
    <div className="view view-countdown">
      <h2>{view.title}</h2>
      <p className="countdown-number">{secondsLeft}</p>
    </div>
  );
}
