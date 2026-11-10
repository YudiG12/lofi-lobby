# AGENTS.md

Instructions for AI coding agents working in this repository.

## Deploying it for someone

The person wants their own Lofi Lobby on their Cloudflare account. Run the installer; it is safe to re-run.

```sh
npm ci
npm run deploy-your-own
```

- Two steps are the person's, never yours:
  1. **Cloudflare sign-in:** they run `npx wrangler login` in their terminal and approve in the browser.
  2. **Admin password:** they run `npx wrangler secret put ADMIN_PASSWORD` in their own terminal and type it into Wrangler's hidden prompt. **Never ask for the password in chat, never pass it as an argument or write it to a file.**
- When it finishes, it prints the URL. Open it in two tabs and check: both trainers show up, a chat message reaches the other tab, the radio plays after "enter the room".

## Working on the code

- Check changes in the browser; anything multiplayer in two tabs.
- Design decisions are ADRs in `docs/adr/`; the low-level design is `ARCHITECTURE.md`.
- The server trusts nothing from the client: keep the limits and cleaning in `worker/index.js` ([SECURITY.md](SECURITY.md)).
- Never commit or deploy third-party art. `public/assets/` is local only and ignored by Git and by the build ([ADR 004](docs/adr/004-original-art-in-the-repo-local-assets-ignored.md)).
- Secrets live only in Worker secrets and the git-ignored `.dev.vars`.
