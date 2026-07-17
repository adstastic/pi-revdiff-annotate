// Terminal handoff follows revdiff's MIT-licensed Pi integration; see THIRD_PARTY_NOTICES.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface AssistantTurn {
	id: string;
	role: "assistant";
	text: string;
	timestamp: string;
}

export function parseCount(raw: string): number | undefined {
	const value = raw.trim();
	if (!value) return 1;
	if (!/^[1-9]\d*$/.test(value)) return undefined;
	const count = Number(value);
	return Number.isSafeInteger(count) ? count : undefined;
}

export function assistantTurns(entries: unknown[], count: number): AssistantTurn[] {
	const turns: AssistantTurn[] = [];

	for (const value of entries) {
		if (!isRecord(value) || value.type !== "message" || !isRecord(value.message)) continue;
		const message = value.message;
		if (message.role !== "assistant" || message.stopReason !== "stop") continue;

		const text = textContent(message.content);
		if (!text) continue;

		turns.push({
			id: typeof value.id === "string" ? value.id : "unknown",
			role: "assistant",
			text,
			timestamp: typeof value.timestamp === "string" ? value.timestamp : "unknown",
		});
	}

	return turns.slice(-count);
}

export function renderSnapshot(turns: AssistantTurn[]): string {
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

export function feedbackPrompt(turns: AssistantTurn[], snapshotPath: string, annotations: string): string {
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
		description: "Annotate last N completed assistant responses in revdiff (default: 1)",
		getArgumentCompletions: (prefix) =>
			["1", "2", "3", "5", "10"]
				.filter((value) => value.startsWith(prefix.trim()))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/annotate requires interactive Pi", "error");
				return;
			}

			const count = parseCount(args);
			if (!count) {
				ctx.ui.notify("Usage: /annotate [positive message count]", "warning");
				return;
			}

			const turns = assistantTurns(ctx.sessionManager.getBranch(), count);
			if (turns.length === 0) {
				ctx.ui.notify("No assistant responses to annotate", "warning");
				return;
			}

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
			pi.sendUserMessage(feedbackPrompt(turns, snapshotPath, result.annotations));
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
