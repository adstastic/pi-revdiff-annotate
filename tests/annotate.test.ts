import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

import annotateExtension, {
	assistantCandidates,
	candidateOption,
	feedbackPrompt,
	parseCount,
	renderSnapshot,
} from "../extensions/annotate.ts";

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
		timestamp: "2026-07-17T10:00:30.000Z",
		message: {
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "visible commentary" },
				{ type: "toolCall", id: "call1", name: "write", arguments: { secret: "ignored" } },
				{ type: "text", text: "continued" },
			],
		},
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
				{ type: "text", text: "second answer line one\nsecond answer line two" },
			],
		},
	},
	{
		type: "message",
		id: "empty001",
		timestamp: "2026-07-17T10:02:00.000Z",
		message: {
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "hidden" },
				{ type: "toolCall", id: "call2", name: "read", arguments: {} },
			],
		},
	},
];

assert.equal(parseCount(""), 20);
assert.equal(parseCount("3"), 3);
assert.equal(parseCount("0"), undefined);
assert.equal(parseCount("two"), undefined);

assert.deepEqual(assistantCandidates(entries, 2).map((candidate) => candidate.id), ["agent002", "progress1"]);
const candidates = assistantCandidates(entries, 20);
assert.deepEqual(candidates.map((candidate) => candidate.id), ["agent002", "progress1", "agent001"]);
assert.equal(candidates[1]!.text, "visible commentary\ncontinued");
assert.equal(candidates[1]!.stopReason, "toolUse");
assert.doesNotMatch(candidates[1]!.text, /hidden|secret|write/);

const selected = candidates[1]!;
const snapshot = renderSnapshot([selected]);
assert.match(snapshot, /# Assistant response 1 of 1/);
assert.match(snapshot, /entry: progress1/);
assert.match(snapshot, /visible commentary\ncontinued/);
assert.doesNotMatch(snapshot, /second answer/);

const option = candidateOption(selected);
assert.match(option, /^\d{2}:\d{2}/);
assert.match(option, /visible commentary/);
assert.match(option, /\[toolUse\]/);
assert.match(option, /progress1/);
assert.doesNotMatch(option, /continued/);
assert.match(candidateOption({ ...selected, text: `  \n${"x".repeat(50)}\nignored` }), /x{39}…/);

const duplicateEntries = [
	{
		type: "message",
		id: "duplicate1",
		timestamp: "2026-07-17T10:03:00.000Z",
		message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "same preview" }] },
	},
	{
		type: "message",
		id: "duplicate2",
		timestamp: "2026-07-17T10:03:00.000Z",
		message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "same preview" }] },
	},
];
const duplicates = assistantCandidates(duplicateEntries, 20);
assert.notEqual(candidateOption(duplicates[0]!), candidateOption(duplicates[1]!));
assert.match(candidateOption(duplicates[0]!), /duplicate2/);
assert.match(candidateOption(duplicates[1]!), /duplicate1/);
const duplicateOptions = new Map(duplicates.map((candidate) => [candidateOption(candidate), candidate]));
assert.equal(duplicateOptions.get(candidateOption(duplicates[1]!))!.id, "duplicate1");

const prompt = feedbackPrompt([selected], "/tmp/pi-annotate/conversation.md", "Needs evidence.");
assert.match(prompt, /your previous assistant response/);
assert.match(prompt, /Session entries: progress1/);
assert.match(prompt, /Read the exact source snapshot/);
assert.match(prompt, /Needs evidence\./);

async function checkCancelHasNoSideEffects(): Promise<void> {
	let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
	let customCalled = false;
	let messageSent = false;
	const notices: string[] = [];
	const pi = {
		on() {},
		registerCommand(_name: string, command: { handler: typeof handler }) {
			handler = command.handler;
		},
		sendUserMessage() {
			messageSent = true;
		},
	};
	annotateExtension(pi as never);

	const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pi-annotate-")));
	await handler!("", {
		mode: "tui",
		sessionManager: { getBranch: () => entries },
		ui: {
			notify(message: string) {
				notices.push(message);
			},
			select: async () => undefined,
			custom() {
				customCalled = true;
				throw new Error("revdiff must not launch after cancel");
			},
		},
	});
	const after = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pi-annotate-")));

	assert.deepEqual(after, before);
	assert.equal(customCalled, false);
	assert.equal(messageSent, false);
	assert.deepEqual(notices, []);
}

checkCancelHasNoSideEffects()
	.then(() => console.log("annotate extension checks passed"))
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
