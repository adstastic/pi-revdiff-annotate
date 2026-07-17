# pi-revdiff-annotate

Annotate recent Pi assistant responses in [revdiff](https://github.com/umputun/revdiff), then return those comments to the conversation.

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
/annotate       # latest completed assistant response
/annotate 3     # latest 3 completed assistant responses
```

The extension:

1. Reads completed assistant messages from the active Pi session branch.
2. Writes the selected messages, oldest first, into one temporary Markdown file.
3. Suspends Pi while revdiff owns the terminal.
4. Sends captured annotations back as the next user message, with the snapshot path and session entry IDs.

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
