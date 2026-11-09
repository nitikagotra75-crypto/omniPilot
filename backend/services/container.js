// Dependency container wiring every subsystem together.
import fs from "node:fs";
import { BrowserManager } from "../browser/manager.js";
import { ComputerController } from "../computer/controller.js";
import { loadNutDriver } from "../computer/driver.js";
import { Orchestrator } from "../orchestrator/engine.js";
import { buildRegistry } from "../tools/index.js";
import { ApprovalService } from "./approvalService.js";
import { EventBus } from "./eventBus.js";
import { PathGuard, defaultRoots } from "./pathGuard.js";
import { PermissionService } from "./permissionService.js";
import { SecretStore } from "./secretStore.js";
import { SettingsService } from "./settingsService.js";

export async function buildContainer(config, overrides = {}) {
  for (const d of [config.dataDir, config.workspaceDir, config.outputsDir, config.uploadsDir]) fs.mkdirSync(d, { recursive: true });
  const bus = new EventBus();
  const settings = new SettingsService(config.modelOverrides);
  const secrets = overrides.secrets || new SecretStore({ file: config.secretsFile, masterKey: config.masterKey });
  const perms = new PermissionService();
  const approvals = new ApprovalService(bus);
  const roots = (await settings.get("allowed_roots")) || defaultRoots(config.workspaceDir);
  const guard = new PathGuard(roots);
  const browser = overrides.browser || new BrowserManager({
    profilesDir: config.browserProfilesDir, headless: config.browserHeadless, allowLocal: config.allowLocalBrowse,
  });
  const computer = overrides.computer || new ComputerController({ driverLoader: loadNutDriver });
  const registry = buildRegistry({ browser, computer, config, secrets, settings });
  const orchestrator = new Orchestrator({ computer, bus, registry, perms, approvals, guard, config, settings, secrets, providerFactory: overrides.providerFactory });
  return { config, bus, settings, secrets, perms, approvals, guard, browser, computer, registry, orchestrator };
}
