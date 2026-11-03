// Where the device keeps the saved sessions (saved.ts), one entry per session: the browser's storage on the web,
// files in a folder of the app's own documents on a phone (expo-file-system, which every Expo build already carries,
// so the fingerprint doesn't change). Reads/writes are best effort; enumeration and deletion must report failure
// so Delete my data cannot claim success while notes remain on the device.
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import type { SavedSessionStorage } from "./saved.ts";

/** lumente.session.<id> in the browser; lumente.session was the one entry every session shared before Oct 27. */
const PREFIX = "lumente.session.";
const LEGACY_KEY = "lumente.session";
const LEGACY_NAME = "session.json";
/** A session id as the API makes them, so it is safe in a key and in a file name. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const web = Platform.OS === "web";
// the web's File is a stub that only warns, so none is built there
const folder = () => new Directory(Paths.document, "sessions");
const fileOf = (id: string) => new File(folder(), `${id}.json`);
const legacyFile = () => new File(Paths.document, LEGACY_NAME);
const store = () => {
  if (typeof localStorage === "undefined") throw new Error("Device storage is unavailable");
  return localStorage;
};

async function quietly<T>(work: () => T | Promise<T>, otherwise: T): Promise<T> {
  try {
    return await work();
  } catch {
    return otherwise;
  }
}

function webIds(): string[] {
  const s = store();
  const ids: string[] = [];
  for (let i = 0; s && i < s.length; i++) {
    const key = s.key(i) ?? "";
    const id = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : "";
    if (ID.test(id)) ids.push(id);
  }
  return ids;
}

export const deviceStorage: SavedSessionStorage = {
  ids: async () => {
      if (web) return webIds();
      const dir = folder();
      return dir.exists ? dir.list().flatMap((entry) => (entry instanceof File && entry.name.endsWith(".json") && ID.test(entry.name.slice(0, -5)) ? [entry.name.slice(0, -5)] : [])) : [];
  },
  read: (id) =>
    quietly(async () => {
      if (!ID.test(id)) return null;
      if (web) return store()?.getItem(PREFIX + id) ?? null;
      const f = fileOf(id);
      return f.exists ? await f.text() : null;
    }, null),
  write: (id, text) =>
    quietly(async () => {
      if (!ID.test(id)) return;
      if (web) {
        store()?.setItem(PREFIX + id, text);
        return;
      }
      const dir = folder();
      if (!dir.exists) dir.create();
      const f = fileOf(id);
      if (!f.exists) f.create();
      await f.write(text);
    }, undefined),
  remove: async (id) => {
      if (!ID.test(id)) return;
      if (web) {
        store()?.removeItem(PREFIX + id);
        return;
      }
      const f = fileOf(id);
      if (f.exists) f.delete();
  },
  legacy: {
    read: () =>
      quietly(async () => {
        if (web) return store()?.getItem(LEGACY_KEY) ?? null;
        const f = legacyFile();
        return f.exists ? await f.text() : null;
      }, null),
    remove: async () => {
        if (web) {
          store()?.removeItem(LEGACY_KEY);
          return;
        }
        const f = legacyFile();
        if (f.exists) f.delete();
    },
  },
};
