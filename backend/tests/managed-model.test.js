// The AI model can be fixed in backend/.env so end users never enter a key.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { modelOverrides } from "../config/env.js";
import { SecretStore } from "../services/secretStore.js";
import { ScriptedProvider, setup, text } from "./helpers.js";

let c;
afterEach(() => c?.teardown());

describe("model managed from the environment", () => {
  test("empty variables are ignored, values are trimmed", () => {
    assert.deepEqual(modelOverrides({ OMNIPILOT_LLM_PROVIDER: " custom ", OMNIPILOT_LLM_MODEL: "", OMNIPILOT_LLM_BASE_URL: "http://x/v1" }), { llm_provider: "custom", llm_base_url: "http://x/v1" });
    assert.deepEqual(modelOverrides({}), {});
  });

  test("OMNIPILOT_LLM_API_KEY is read as the model key, and is never echoed", () => {
    const store = new SecretStore({ env: { OMNIPILOT_LLM_API_KEY: "sk-test" } });
    assert.equal(store.isConfigured("llm_api_key"), true);
    assert.equal(store.get("llm_api_key"), "sk-test");
    assert.equal(new SecretStore({ env: {} }).isConfigured("llm_api_key"), false);
  });

  test("status reports the managed model; the app cannot change model, provider or key", async () => {
    c = await setup({ provider: new ScriptedProvider([text("hi")]), env: { OMNIPILOT_LLM_PROVIDER: "custom", OMNIPILOT_LLM_MODEL: "m-1", OMNIPILOT_LLM_BASE_URL: "http://127.0.0.1:1/v1" } });
    const st = (await c.req("GET", "/api/status")).json;
    assert.equal(st.llm_configured, true); assert.equal(st.model, "m-1"); assert.equal(st.provider, "custom"); assert.equal(st.model_managed, true);
    const put = await c.req("PUT", "/api/settings", { llm_model: "other" });
    assert.equal(put.status, 409); assert.match(put.json.detail, /backend\/\.env/);
    assert.equal((await c.req("PUT", "/api/secrets/llm_api_key", { value: "sk-x" })).status, 409);
    assert.equal((await c.req("PUT", "/api/settings", { language: "hi" })).status, 200); // other settings stay editable
    assert.equal((await c.req("GET", "/api/status")).json.model, "m-1");
  });

  test("without overrides nothing is managed and settings stay editable", async () => {
    c = await setup({ provider: new ScriptedProvider([]) });
    assert.equal((await c.req("GET", "/api/status")).json.model_managed, false);
    assert.equal((await c.req("PUT", "/api/settings", { llm_model: "x" })).status, 200);
  });
});
