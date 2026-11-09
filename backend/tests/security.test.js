import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { isPrivateIp, checkUrl, UrlBlocked } from "../browser/urlPolicy.js";
import { connectDb } from "../config/db.js";
import { PathGuard, PathNotAllowed } from "../services/pathGuard.js";
import { PermissionService } from "../services/permissionService.js";
import { SecretStore } from "../services/secretStore.js";
import { MONGO } from "./helpers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "op-sec-"));

describe("PathGuard", () => {
  test("allows inside, blocks outside and traversal", () => {
    const root = tmp(), g = new PathGuard([root]);
    assert.equal(g.resolve(path.join(root, "a.txt")), path.join(fs.realpathSync(root), "a.txt"));
    assert.throws(() => g.resolve(path.join(root, "..", "other.txt")), PathNotAllowed);
    assert.throws(() => g.resolve("/etc/passwd"), PathNotAllowed);
  });
  test("blocks symlink escape, even for files that do not exist yet", () => {
    const root = tmp(), outside = tmp();
    fs.symlinkSync(outside, path.join(root, "link"));
    const g = new PathGuard([root]);
    assert.throws(() => g.resolve(path.join(root, "link", "secret.txt")), PathNotAllowed);
  });
  test("uniqueOutput never overwrites", () => {
    const root = tmp(), f = path.join(root, "a.pdf");
    fs.writeFileSync(f, "x");
    const g = new PathGuard([root]);
    const first = g.uniqueOutput(f, "-compressed"); fs.writeFileSync(first, "y");
    const second = g.uniqueOutput(f, "-compressed");
    assert.notEqual(first, second); assert.ok(!fs.existsSync(second));
  });
});

describe("PermissionService", () => {
  const dbName = "t_perm_" + Math.random().toString(36).slice(2, 8);
  before(() => connectDb(`${MONGO}/${dbName}`));
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  test("delete/publish/finance can never be blanket-allowed", async () => {
    const p = new PermissionService();
    await assert.rejects(p.setGrant("fs.delete", "allow"), /always requires confirmation/);
    assert.equal(await p.decide(["fs.delete"]), "ask");
    await p.setGrant("fs.delete", "deny");
    assert.equal(await p.decide(["fs.delete"]), "deny");
  });
  test("uses the strictest permission and validates input", async () => {
    const p = new PermissionService();
    assert.equal(await p.decide(["fs.read"]), "allow");
    assert.equal(await p.decide(["fs.read", "app.launch"]), "ask");
    await assert.rejects(p.setGrant("nope", "allow"), /Unknown permission/);
    await assert.rejects(p.setGrant("fs.read", "maybe"), /allow, ask or deny/);
  });
});

describe("SecretStore", () => {
  test("encrypted file never contains the secret and survives reload", () => {
    const file = path.join(tmp(), "s.json");
    const a = new SecretStore({ file, masterKey: "master-1", env: {} });
    a.set("llm_api_key", "sk-very-secret");
    assert.equal(a.backend, "encrypted-file");
    assert.ok(!fs.readFileSync(file, "utf8").includes("sk-very-secret"));
    assert.equal(new SecretStore({ file, masterKey: "master-1", env: {} }).get("llm_api_key"), "sk-very-secret");
    assert.equal(new SecretStore({ file, masterKey: "wrong-key", env: {} }).get("llm_api_key"), null);
  });
  test("falls back to memory, then to environment variables; delete works", () => {
    const s = new SecretStore({ env: { OMNIPILOT_SECRET_LLM_API_KEY: "from-env" } });
    assert.equal(s.backend, "process-memory");
    assert.equal(s.get("llm_api_key"), "from-env");
    s.set("llm_api_key", "mem"); assert.equal(s.get("llm_api_key"), "mem");
    s.delete("llm_api_key"); assert.equal(s.get("llm_api_key"), "from-env");
  });
});

describe("URL policy", () => {
  test("private and loopback addresses are recognised", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.9", "172.20.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateIp(ip), ip);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) assert.ok(!isPrivateIp(ip), ip);
  });
  test("blocks non-web schemes and local targets, allows when told to", async () => {
    for (const u of ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "ftp://x.org/f", "http://localhost:3000/", "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://printer.local/"])
      await assert.rejects(checkUrl(u), UrlBlocked, u);
    await checkUrl("http://127.0.0.1:8080/", { allowLocal: true });
  });
});
