# Contributing

## Development

Node 20 or later.

```sh
npm ci
printf 'ADMIN_PASSWORD=%s\nALLOWED_ORIGINS=http://localhost:5173\n' "$(openssl rand -hex 8)" > .dev.vars
npm run dev:server    # Worker + Durable Object on :8787
npm run dev           # site on http://localhost:5173 (proxies /ws to :8787)
npm run build         # production build in dist/
```

To deploy your own: `npm run deploy-your-own` ([README](README.md#deploy-your-own)).

## How changes are made

1. **One change per PR**, with the why in the description. Design decisions become an ADR in `docs/adr/`.
2. **Check it in the browser** (two tabs for anything multiplayer) before opening the PR.
3. **Review** by a separate reviewer with a clean context (only the diff and the docs).
4. **Docs and diagrams** are merged only after the owner approves them.
5. **No third-party assets**: art in the repo is original or generated in code ([ADR 004](docs/adr/004-original-art-in-the-repo-local-assets-ignored.md)).
