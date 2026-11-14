import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { messageFor, twiml } from "../src/messages";

test("STOP variants opt out and do not duplicate Twilio confirmations", () => {
  for (const command of ["stop", " STOPALL ", "cancel", "revoke"]) {
    assert.deepEqual(messageFor(command), { reply: "", optedOut: true });
  }
  assert.equal(messageFor("START").optedOut, false);
});
test("prototype does not claim to have computed crop advice", () => {
  assert.match(messageFor("alfalfa Fallon save water").reply, /Crop advice is not connected yet/);
});
test("farmer text cannot inject XML elements", async () => {
  const xml = await twiml('A&B <Message>"test"</Message>').text();
  assert.match(xml, /A&amp;B &lt;Message&gt;&quot;test&quot;&lt;\/Message&gt;/);
});
test("signature validation rejects tampered form data and changed URL", () => {
  const token = "test-only-token";
  const url = "https://example.com/webhooks/sms";
  const params = { Body: "hello", From: "+15555550100", ExtraFutureField: "supported" };
  const signature = twilio.getExpectedTwilioSignature(token, url, params);
  assert.equal(twilio.validateRequest(token, signature, url, params), true);
  assert.equal(twilio.validateRequest(token, signature, url, { ...params, Body: "tampered" }), false);
  assert.equal(twilio.validateRequest(token, signature, url + "?changed=1", params), false);
});
