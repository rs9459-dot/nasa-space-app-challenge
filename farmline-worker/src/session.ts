/**
 * One Durable Object per farmer phone number. It remembers the farmer's last answer
 * (place, crop, the 3 plans) so a reply of "1", "2" or "3" gets that plan's details,
 * and every message from the same farmer is handled by the same object, in order.
 */
export class FarmerSession {
  constructor(private state: DurableObjectState) {}

  // Keys: "last" (the farmer's last answer) and "call-<CallSid>" (a phone call's answer while it is being prepared).
  async fetch(request: Request): Promise<Response> {
    const key = new URL(request.url).pathname.slice(1) || "last";
    if (request.method === "PUT") {
      await this.state.storage.put(key, await request.json());
      return new Response("ok");
    }
    if (request.method === "DELETE") {
      await this.state.storage.delete(key);
      return new Response("ok");
    }
    const value = await this.state.storage.get(key);
    return Response.json(value ?? null);
  }
}
