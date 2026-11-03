import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { SavedSessionStorage } from "./saved.ts";

// Exercise the device adapter itself, with only native module loading replaced for Node.
const modules: Record<string, string> = {
  "react-native": 'export const Platform = { OS: "web" };',
  "expo-file-system": `
    export const Paths = { document: 'test' };
    export class File { exists = true; name = 's1.json'; delete() { throw new Error('disk denied'); } }
    export class Directory { exists = true; list() { return [new File()]; } }
  `,
};
registerHooks({ resolve(specifier, context, next) {
  return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context);
} });
const { deviceStorage } = await import("./storage.ts");

test("web deletion reports failed enumeration, session removal, and legacy removal", async (t) => {
  const storage = {
    get length() { throw new Error("storage denied"); },
    removeItem() { throw new Error("storage denied"); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  await assert.rejects(deviceStorage.ids(), /storage denied/);
  await assert.rejects(deviceStorage.remove("s1"), /storage denied/);
  await assert.rejects(deviceStorage.legacy.remove(), /storage denied/);
});

test("native deletion reports a failed file removal", async () => {
  const { Platform } = await import("react-native");
  Platform.OS = "ios";
  const path = "./storage.ts?native";
  const { deviceStorage: native }: { deviceStorage: SavedSessionStorage } = await import(path);
  await assert.rejects(native.remove("s1"), /disk denied/);
  await assert.rejects(native.legacy.remove(), /disk denied/);
});
