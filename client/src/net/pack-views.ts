/**
 * How the Screen sends Views: as few `views` messages as fit under MAX_MESSAGE_BYTES, measured as
 * UTF-8 JSON. Views are added in order to the current message until the next one won't fit, and
 * only then is another message started. So an ordinary event is one message, and only large Views
 * (drawings) take several. A Controller View is at most MAX_VIEW_BYTES (128 KB, half the message
 * limit), so a single View always fits a message of its own. Every message carries the same timer.
 */
import { MAX_MESSAGE_BYTES, type ScreenToServer } from "@boilergames/protocol";

type ViewsMessage = Extract<ScreenToServer, { type: "views" }>;

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

export function packViews(views: ReadonlyMap<string, unknown>, timerMs: number | null): ViewsMessage[] {
  const messages: ViewsMessage[] = [];
  // The message's bytes without any View: `{"type":"views","views":{},"timerMs":...}`.
  const empty = bytes(JSON.stringify({ type: "views", views: {}, timerMs }));
  let current: Record<string, unknown> = {};
  let count = 0;
  let size = empty;
  for (const [seatId, view] of views) {
    // `"id":{...}`, plus a comma before it if the message already holds a View.
    const entry = bytes(JSON.stringify(seatId)) + 1 + bytes(JSON.stringify(view) ?? "null");
    if (count > 0 && size + 1 + entry > MAX_MESSAGE_BYTES) {
      messages.push({ type: "views", views: current, timerMs });
      current = {};
      count = 0;
      size = empty;
    }
    size += (count > 0 ? 1 : 0) + entry;
    current[seatId] = view;
    count += 1;
  }
  if (count > 0 || messages.length === 0) messages.push({ type: "views", views: current, timerMs });
  return messages;
}
