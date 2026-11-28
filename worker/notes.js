// Message wall helpers with no storage or crypto in them, so the tests can import them.
import { badName, normalize } from "./moderation.js";

// the name a note is signed with: the same cleaning as a new note ("trainer" when it is empty or refused)
export function wallName(raw) {
  const name = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  if (!name || badName(name) || /admin|moderador|moderator|staff/.test(normalize(name))) return "trainer";
  return name;
}

// The writer changed their name: their notes carry the new one. `notes` is a Map of id -> note;
// only the notes of `owner` whose name or gender changed come back (id -> new note), so only those are written.
export function renamedNotes(notes, owner, name, gender) {
  const out = new Map();
  if (!owner) return out;
  for (const [id, note] of notes) {
    if (!note || note.owner !== owner) continue;
    if (note.name === name && note.gender === gender) continue;
    out.set(id, { ...note, name, gender });
  }
  return out;
}
