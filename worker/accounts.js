// Accounts and their sessions, in D1 (binding DB): the one place that knows who has an account, whatever
// room they are in. A room asks here; nothing in this file is sent to a browser as it is.
//
//   accounts  n           the account number, in the order accounts were made (0 is the repository's owner)
//             github_id   GitHub's own number for the user: it stays the same when they rename themselves,
//                         so it is what says "this is the same person" (NULL until their first login after
//                         accounts moved here)
//             login       their GitHub login now, lower case (what merged pull requests are counted by)
//             email       their verified primary e-mail at GitHub, read on a login (scope user:email).
//                         Kept here only: it is never sent to a browser, not even to its owner
//             created_at  when the account was made (ms): the Founding member medal goes by it
//             name, color, gender, cap   the trainer it was last seen as, for a profile and a friends list
//             bio         what its owner wrote about themselves, shown on the profile
//   sessions  hash        SHA-256 of the random session a browser keeps after a login ("gh:<hex>")
//             n           whose it is
//
// Before D1 the room kept accounts ("acct:<n>", "acct-of:<login>") and sessions ("gh:<hex>") in its own
// storage. Accounts are copied over once, with their numbers. Their sessions are not: an account from
// then has no GitHub id, so its browsers log in again once (see session), and that login adopts it.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
     n INTEGER PRIMARY KEY, github_id INTEGER UNIQUE, login TEXT NOT NULL UNIQUE, email TEXT,
     created_at INTEGER NOT NULL, name TEXT, color TEXT, gender TEXT, cap INTEGER, bio TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, n INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_n ON sessions (n)`,
];
const COLUMNS = "n, github_id, login, created_at, name, color, gender, cap, bio";
// columns added after the table first existed: [name, type]. A database made before one gets it on the next start.
const ADDED = [["bio", "TEXT"]];
// an account as the rest of the server knows it (no e-mail: nothing outside this file needs it)
const account = (row) => row && { n: row.n, login: row.login, at: row.created_at, name: row.name || "", color: row.color || "", gender: row.gender || "male", cap: row.cap ?? -1, bio: row.bio || "" };

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
/** The verified primary e-mail in GitHub's answer to /user/emails, or null. */
export function primaryEmail(list) {
  if (!Array.isArray(list)) return null;
  const ok = list.filter((e) => e && e.verified === true && typeof e.email === "string" && EMAIL.test(e.email));
  const pick = ok.find((e) => e.primary === true) || ok[0];
  return pick ? pick.email.toLowerCase() : null;
}

/**
 * The accounts of one deploy. `storage` is the room's own storage, where accounts used to live.
 * Every method throws when D1 fails; the caller decides what the player is told.
 */
export class Accounts {
  constructor(db, storage, owner) {
    this.db = db;
    this.storage = storage;
    this.owner = owner; // the GitHub login that gets account 0
    this.setup = null;
  }
  get on() {
    return !!this.db;
  }
  // tables, and the accounts the room kept before D1 (once: "accounts-in-d1" in the room's storage)
  ready() {
    this.setup ||= (async () => {
      await this.db.batch(SCHEMA.map((sql) => this.db.prepare(sql)));
      const { results } = await this.db.prepare("SELECT name FROM pragma_table_info('accounts')").all();
      for (const [name, type] of ADDED) {
        if (!results.some((c) => c.name === name)) await this.db.prepare(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`).run();
      }
      if (await this.storage.get("accounts-in-d1")) return;
      const old = [...(await this.storage.list({ prefix: "acct:" })).values()].filter((a) => Number.isInteger(a?.n) && typeof a.login === "string");
      const add = this.db.prepare("INSERT OR IGNORE INTO accounts (n, login, created_at, name, color, gender, cap) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (let i = 0; i < old.length; i += 50) {
        await this.db.batch(old.slice(i, i + 50).map((a) => add.bind(a.n, a.login, a.at || Date.now(), a.name || null, a.color || null, a.gender || null, Number.isInteger(a.cap) ? a.cap : null)));
      }
      await this.storage.put("accounts-in-d1", Date.now());
    })().catch((err) => {
      this.setup = null; // try again on the next use
      throw err;
    });
    return this.setup;
  }

  /** @returns {Promise<object|null>} the account with that number */
  async get(n) {
    await this.ready();
    return account(await this.db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE n = ?`).bind(n).first());
  }
  /** @returns {Promise<Map<number, object>>} the accounts with those numbers */
  async many(numbers) {
    await this.ready();
    const found = new Map();
    for (let i = 0; i < numbers.length; i += 90) {
      const part = numbers.slice(i, i + 90);
      const { results } = await this.db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE n IN (${part.map(() => "?").join(",")})`).bind(...part).all();
      for (const row of results) found.set(row.n, account(row));
    }
    return found;
  }
  // a new account: the owner's login is number 0, everyone else the next number
  async create(login, githubId, email) {
    const n = login === this.owner ? "0" : "(SELECT COALESCE(MAX(n), 0) + 1 FROM accounts)";
    const row = await this.db.prepare(`INSERT INTO accounts (n, github_id, login, email, created_at) VALUES (${n}, ?, ?, ?, ?) RETURNING ${COLUMNS}`)
      .bind(githubId, login, email, Date.now()).first();
    return { ...account(row), created: true };
  }
  /**
   * A GitHub login that just proved itself: its account, made now if it is the first time.
   * The same GitHub user is the same account even after a rename; a login that changed hands is not.
   * @param {{login: string, githubId: number|null, email: string|null}} who
   */
  async signIn({ login, githubId, email }) {
    await this.ready();
    const db = this.db;
    let row = githubId == null ? null : await db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE github_id = ?`).bind(githubId).first();
    const named = await db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE login = ?`).bind(login).first();
    // an account from before D1 has no GitHub id yet: the login is all there is to go by, this once
    if (!row && named && named.github_id == null) row = named;
    // that login belongs to another account, whose owner renamed themselves at GitHub and left it free:
    // their account lets go of the name, for one no GitHub user can have (it is set right on their next login)
    if (named && named.n !== row?.n) await db.prepare("UPDATE accounts SET login = ? WHERE n = ?").bind(`-gone-${named.n}`, named.n).run();
    if (!row) {
      try {
        return await this.create(login, githubId, email);
      } catch (err) {
        // two logins of the same new user at once: the other one made the account
        row = githubId == null ? null : await db.prepare(`SELECT ${COLUMNS} FROM accounts WHERE github_id = ?`).bind(githubId).first();
        if (!row) throw err;
      }
    }
    await db.prepare("UPDATE accounts SET login = ?, github_id = COALESCE(?, github_id), email = COALESCE(?, email) WHERE n = ?").bind(login, githubId, email, row.n).run();
    return { ...account(row), login };
  }
  /** The trainer an account is seen as now (written only when it changed). */
  async saveLook(n, { name, color, gender, cap }) {
    await this.ready();
    await this.db.prepare(
      "UPDATE accounts SET name = ?, color = ?, gender = ?, cap = ? WHERE n = ? AND (name IS NOT ? OR color IS NOT ? OR gender IS NOT ? OR cap IS NOT ?)",
    ).bind(name, color, gender, cap, n, name, color, gender, cap).run();
  }

  /** What an account's owner wrote about themselves ("" clears it). */
  async saveBio(n, bio) {
    await this.ready();
    await this.db.prepare("UPDATE accounts SET bio = ? WHERE n = ?").bind(bio || null, n).run();
  }

  // ---- sessions ----
  async openSession(hash, n) {
    await this.ready();
    await this.db.prepare("INSERT OR REPLACE INTO sessions (hash, n, created_at) VALUES (?, ?, ?)").bind(hash, n, Date.now()).run();
  }
  /**
   * Whose session that is, or null: the browser then has to log in again.
   * A session only holds for an account that already logged in since accounts are tied to the GitHub
   * user (it has a github_id). One from before that, in D1 or still in the room's storage, is ended
   * here: the next login brings the account its GitHub id and e-mail, and it is the same account.
   * @returns {Promise<object|null>}
   */
  async session(hash) {
    await this.ready();
    const row = await this.db.prepare(`SELECT ${COLUMNS.split(", ").map((c) => "a." + c).join(", ")} FROM sessions s JOIN accounts a ON a.n = s.n WHERE s.hash = ?`).bind(hash).first();
    if (row?.github_id != null) return account(row);
    if (row) await this.db.prepare("DELETE FROM sessions WHERE hash = ?").bind(hash).run();
    await this.storage.delete(hash);
    return null;
  }
  async closeSession(hash) {
    await this.ready();
    await this.db.prepare("DELETE FROM sessions WHERE hash = ?").bind(hash).run();
    await this.storage.delete(hash);
  }
}
