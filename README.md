# Delve

A read-only AI research agent for your Obsidian vault.

Give Delve a task — "which notes talk about X and do they agree with each other?",
"summarize everything tagged #project/foo" — and it autonomously investigates your
vault to answer it: browsing folders and tags, searching file contents, following
links and backlinks, and reading attachments, using the [Gemini API](https://ai.google.dev/gemini-api/docs)
alongside Google Search, Code Execution and URL Context. When it's done, it hands you
a structured report you can export as a zip, written straight into your vault.

## Read-only, by construction

Delve cannot create, modify, move, or delete anything in your vault. This isn't just a
prompt instruction the model is asked to follow — the agent's tool set is a fixed
whitelist of 15 read-only operations enforced in code (`src/vault/read-only-vault-service.ts`).
There is no write/delete Vault API call anywhere it can reach, regardless of what any
instruction — including one hidden inside a note it reads — asks it to do. Exporting a
report is a separate, explicit action you trigger yourself; the agent has no path to it.

## Setup

1. Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Delve isn't on the
   Community Plugin store) — add `FilipBambura/Delve` as a beta plugin.
2. Open Delve's settings and enter a [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key).
   Optionally encrypt it at rest with a password.
3. Run the **Investigate vault** command (or click Delve's ribbon icon), describe your
   task, and let it work. Watch its tool-call trace live in the modal.
4. Once it's done, click **Export report** to save a zip (`report.md`, `sources.md`,
   `findings.json`, `vault-map.json`, `trace.json`) into your vault.

Works on both desktop and mobile.

## Development

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # production build (also type-checks)
```

See [CLAUDE.md](./CLAUDE.md) for the release process.

## License

MIT
