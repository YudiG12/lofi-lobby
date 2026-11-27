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
- The first deploy also creates the D1 database for accounts (`lofi-lobby`); Wrangler does it by itself, there is nothing to run.
- When it finishes, it prints the URL. Open it in two tabs and check: both trainers show up, a chat message reaches the other tab, the radio plays after "enter the room".

## Working on the code

- Check changes in the browser; anything multiplayer in two tabs.
- Design decisions are ADRs in `docs/adr/`; the low-level design is the Architecture section of the `README.md`. Keep ADR entries in the `README.md` Architecture table ordered by ascending ADR number (before non-ADR references such as `SECURITY.md`).
- The server trusts nothing from the client: keep the limits and cleaning in `worker/index.js` ([SECURITY.md](SECURITY.md)).
- Keep the town model, textures and trainer sheets in `public/assets/` versioned and included in production builds; the code-generated fallbacks remain for load failures ([ADR 005](docs/adr/005-version-and-deploy-game-assets.md)).
- Accounts and sessions are in D1 (`worker/accounts.js`, [ADR 015](docs/adr/015-accounts-in-d1.md)); an account's e-mail never goes to a browser.
- Secrets live only in Worker secrets and the git-ignored `.dev.vars`.
