// Terminal handoff follows revdiff's MIT-licensed Pi integration; see THIRD_PARTY_NOTICES.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface AssistantCandidate {
	id: string;
	text: string;
	timestamp: string;
	stopReason: string;
}

export function parseCount(raw: string): number | undefined {
	const value = raw.trim();
	if (!value) return 20;
	if (!/^[1-9]\d*$/.test(value)) return undefined;
	const count = Number(value);
	return Number.isSafeInteger(count) ? count : undefined;
}

export function assistantCandidates(entries: unknown[], count: number): AssistantCandidate[] {
	const candidates: AssistantCandidate[] = [];

	for (const value of entries) {
		if (!isRecord(value) || value.type !== "message" || typeof value.id !== "string" || !isRecord(value.message)) {
			continue;
		}
		const message = value.message;
		if (message.role !== "assistant") continue;

		const text = textContent(message.content);
		if (!text.trim()) continue;

		candidates.push({
			id: value.id,
			text,
			timestamp: typeof value.timestamp === "string" ? value.timestamp : "unknown",
			stopReason: typeof message.stopReason === "string" ? message.stopReason : "unknown",
		});
	}

	return candidates.slice(-count).reverse();
}

export function candidateOption(candidate: AssistantCandidate): string {
	const date = new Date(candidate.timestamp);
	const time = Number.isNaN(date.getTime())
		? "??:??"
		: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	const firstLine = candidate.text.split(/\r?\n/).find((line) => line.trim())!.trim();
	const preview = firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
	return `${time}  ${preview.padEnd(40)}  [${candidate.stopReason}]  (${candidate.id})`;
}

export function renderSnapshot(turns: AssistantCandidate[]): string {
	return turns
		.map((turn, index) =>
			[
				`# Assistant response ${index + 1} of ${turns.length}`,
				"",
				`<!-- pi session entry: ${turn.id}; timestamp: ${turn.timestamp} -->`,
				"",
				turn.text,
			].join("\n"),
		)
		.join("\n\n---\n\n");
}

export function feedbackPrompt(turns: AssistantCandidate[], snapshotPath: string, annotations: string): string {
	const target =
		turns.length === 1 ? "your previous assistant response" : `${turns.length} earlier assistant responses`;
	return [
		`I annotated ${target} from this conversation.`,
		`Session entries: ${turns.map((turn) => turn.id).join(", ")}`,
		`Read the exact source snapshot at \`${snapshotPath}\` before addressing these comments; annotation line numbers refer to that file.`,
		"",
		"Annotations:",
		annotations.trim(),
	].join("\n");
}

export default function annotateExtension(pi: ExtensionAPI): void {
	const tempDirs = new Set<string>();

	pi.on("session_shutdown", () => {
		for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
		tempDirs.clear();
	});

	pi.registerCommand("annotate", {
		description: "Select an assistant message to annotate in revdiff (default depth: 20)",
		getArgumentCompletions: (prefix) =>
			["1", "5", "10", "20", "50"]
				.filter((value) => value.startsWith(prefix.trim()))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/annotate requires interactive Pi", "error");
				return;
			}

			const count = parseCount(args);
			if (!count) {
				ctx.ui.notify("Usage: /annotate [positive candidate depth]", "warning");
				return;
			}

			const candidates = assistantCandidates(ctx.sessionManager.getBranch(), count);
			if (candidates.length === 0) {
				ctx.ui.notify("No assistant messages to annotate", "warning");
				return;
			}

			const options = new Map(candidates.map((candidate) => [candidateOption(candidate), candidate]));
			const selectedOption = await ctx.ui.select("Select assistant message", [...options.keys()]);
			if (!selectedOption) return;
			const selected = options.get(selectedOption);
			if (!selected) return;
			const turns = [selected];

			const dir = mkdtempSync(join(tmpdir(), "pi-annotate-"));
			const snapshotPath = join(dir, "conversation.md");
			const outputPath = join(dir, "annotations.md");
			writeFileSync(snapshotPath, renderSnapshot(turns), "utf8");

			const result = await launchRevdiff(ctx, snapshotPath, outputPath);
			if (result.error) {
				rmSync(dir, { recursive: true, force: true });
				ctx.ui.notify(result.error, "error");
				return;
			}
			if (!result.annotations) {
				rmSync(dir, { recursive: true, force: true });
				ctx.ui.notify("No annotations captured", "info");
				return;
			}

			tempDirs.add(dir);
			pi.sendUserMessage(feedbackPrompt(turns, snapshotPath, result.annotations), { deliverAs: "followUp" });
		},
	});
}

async function launchRevdiff(
	ctx: ExtensionCommandContext,
	snapshotPath: string,
	outputPath: string,
): Promise<{ annotations?: string; error?: string }> {
	let launchError = "";
	let signal = "";
	const binary = process.env.REVDIFF_BIN?.trim() || "revdiff";

	const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _keybindings, done) => {
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");
		const result = spawnSync(binary, [`--only=${snapshotPath}`, `--output=${outputPath}`], {
			env: { ...process.env, REVDIFF_EXIT_CODE_ON_ANNOTATIONS: "true" },
			stdio: "inherit",
		});
		launchError = result.error?.message ?? "";
		signal = result.signal ?? "";
		tui.start();
		tui.requestRender(true);
		done(result.status ?? 1);
		return { render: () => [], invalidate() {} };
	});

	if (launchError) return { error: `Failed to launch revdiff: ${launchError}` };
	if (signal) return { error: `revdiff terminated by signal ${signal}` };
	if (exitCode !== 0 && exitCode !== 10) return { error: `revdiff exited with code ${exitCode ?? "unknown"}` };

	const annotations = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
	return annotations ? { annotations } : {};
}

function textContent(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content : "";
	return content
		.filter(
			(value): value is { type: "text"; text: string } =>
				isRecord(value) && value.type === "text" && typeof value.text === "string",
		)
		.map((value) => value.text)
		.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
