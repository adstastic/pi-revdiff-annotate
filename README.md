# pi-revdiff-annotate

Select a persisted Pi assistant message, annotate it in [revdiff](https://github.com/umputun/revdiff), then return those comments to the conversation.

## Install

Install `revdiff` first:

```bash
brew install umputun/apps/revdiff
```

Install this Pi package:

```bash
pi install https://github.com/adstastic/pi-revdiff-annotate
```

Reload an open Pi session with `/reload`.

## Use

```text
/annotate       # choose from latest 20 text-bearing assistant messages
/annotate 50    # choose from latest 50 candidates
```

The extension:

1. Reads text-bearing assistant messages from the active Pi session branch, including commentary before tool calls.
2. Shows newest candidates first in Pi's built-in selection list.
3. Writes only the selected message's visible text into a temporary Markdown file.
4. Suspends Pi while revdiff owns the terminal.
5. Sends captured annotations back as the next user message, with the snapshot path and session entry ID.

Migration: `N` now controls candidate-list depth; it previously selected and combined the latest `N` completed responses.

Inside revdiff:

- Arrow keys or `j`/`k`: navigate
- `a` or `Enter`: annotate current line
- `A`: add a file-level annotation
- `@`: list annotations
- `q`: submit annotations and return to Pi
- `Q`: discard annotations and return to Pi
- `?`: show help

Quitting without annotations sends nothing. Temporary snapshots remain readable for the session and are removed when Pi shuts down or reloads.

This uses direct terminal handoff, matching revdiff's Pi integration. Returned annotations are a user message, not a tool-result card.

## Development

```bash
npm install
npm test
```

## License

MIT. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for revdiff attribution.
