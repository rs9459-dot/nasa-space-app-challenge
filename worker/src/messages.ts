export const WELCOME = "FarmLine SMS is connected. Send your village + district, current crop, and main goal (save water or improve soil). Crop advice is not connected yet. Reply HELP for help, STOP to stop.";

export function messageFor(body: string): { reply: string; optedOut?: boolean } {
  const command = body.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"].includes(command)) {
    return { reply: "", optedOut: true }; // Twilio manages the carrier-facing confirmation.
  }
  if (["START", "UNSTOP"].includes(command)) {
    return { reply: "", optedOut: false }; // Twilio manages its confirmation.
  }
  if (["HELP", "INFO"].includes(command)) {
    return { reply: "FarmLine prototype: text village + district, current crop, and your goal. No crop recommendation is available until the engine is connected. STOP to stop." };
  }
  return { reply: WELCOME };
}

export function twiml(text = ""): Response {
  const escaped = text.replace(/[<>&\"']/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"
  })[c]!);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${text ? `<Message>${escaped}</Message>` : ""}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" }
  });
}
