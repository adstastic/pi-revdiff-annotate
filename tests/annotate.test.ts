import assert from "node:assert/strict";

import { assistantTurns, feedbackPrompt, parseCount, renderSnapshot } from "../extensions/annotate.ts";

const entries = [
	{
		type: "message",
		id: "agent001",
		timestamp: "2026-07-17T10:00:00.000Z",
		message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "first answer" }] },
	},
	{
		type: "message",
		id: "progress1",
		message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "ignored progress" }] },
	},
	{
		type: "message",
		id: "user0001",
		message: { role: "user", content: "ignored question" },
	},
	{
		type: "message",
		id: "agent002",
		timestamp: "2026-07-17T10:01:00.000Z",
		message: {
			role: "assistant",
			stopReason: "stop",
			content: [
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "second answer line one" },
				{ type: "text", text: "second answer line two" },
			],
		},
	},
];

assert.equal(parseCount(""), 1);
assert.equal(parseCount("3"), 3);
assert.equal(parseCount("0"), undefined);
assert.equal(parseCount("two"), undefined);

assert.deepEqual(assistantTurns(entries, 1).map((turn) => turn.id), ["agent002"]);
const turns = assistantTurns(entries, 2);
assert.deepEqual(turns.map((turn) => turn.id), ["agent001", "agent002"]);
assert.equal(turns[1]!.text, "second answer line one\nsecond answer line two");

const snapshot = renderSnapshot(turns);
assert.match(snapshot, /# Assistant response 1 of 2/);
assert.match(snapshot, /entry: agent001/);
assert.match(snapshot, /first answer/);
assert.match(snapshot, /# Assistant response 2 of 2/);
assert.match(snapshot, /second answer line two/);
assert.ok(snapshot.indexOf("first answer") < snapshot.indexOf("second answer line one"));

const prompt = feedbackPrompt(
	turns,
	"/tmp/pi-annotate/conversation.md",
	"## conversation.md:9 ( )\nNeeds evidence.",
);
assert.match(prompt, /2 earlier assistant responses/);
assert.match(prompt, /Read the exact source snapshot/);
assert.match(prompt, /Needs evidence\./);

console.log("annotate extension checks passed");
