import assert from "node:assert/strict";
import { test } from "node:test";
import { watchParent } from "../utils/parentWatchdog.js";

test("fires when the parent is gone", async () => {
  await new Promise((resolve) => watchParent(2 ** 22 + 12345, resolve, 20));
});
test("stays quiet while the parent is alive", async () => {
  let fired = false;
  const stop = watchParent(process.pid, () => { fired = true; }, 20);
  await new Promise((r) => setTimeout(r, 200)); stop();
  assert.equal(fired, false);
});
