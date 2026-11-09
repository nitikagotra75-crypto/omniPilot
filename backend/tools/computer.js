// Computer-control tools: see the screen, move/click, type, press keys, focus windows. Every action reports what was
// observed afterwards; `verified` is true only when the caller's expectation was actually met (or a readback proved it).
import { ComputerHalted, ComputerRefused } from "../computer/controller.js";
import { ComputerUnavailable } from "../computer/driver.js";
import { listUiElements } from "../computer/uia.js";
import { fail, ok, unverified } from "./registry.js";

const expectSchema = {
  type: "object", additionalProperties: false,
  description: "Optional check the result must satisfy for the action to count as verified. Use it whenever you know what should happen.",
  properties: {
    window_title_contains: { type: "string", description: "The active window's title should contain this text afterwards (e.g. 'Notepad')." },
    screen_changes: { type: "boolean", description: "The screen should visibly change after the action." },
  },
};
const xy = { x: { type: "integer", description: "X in screenshot coordinates" }, y: { type: "integer", description: "Y in screenshot coordinates" } };

/** Converts controller errors into tool failures; unknown errors propagate to the registry's generic handler. */
function guarded(fn) {
  return async (a, ctx) => {
    try { return await fn(a, ctx); }
    catch (e) {
      if (e instanceof ComputerHalted || e instanceof ComputerRefused || e instanceof ComputerUnavailable) return fail(e.message);
      throw e;
    }
  };
}

/** Turn an observed action into a ToolResult. */
function actionResult(obs, what, expect) {
  const base = { ...obs };
  if (expect && obs.expectation_met === true) return ok(base, `${what}; expectation met (${JSON.stringify(expect)}).`);
  if (expect) return { ok: false, data: base, error: `${what}, but the expected outcome was not observed (${JSON.stringify(expect)}). Active window: '${obs.active_window ?? "unknown"}'. Take a screenshot to see the real state.`, recoverable: false, verified: false, verification: "" };
  return unverified(base, `${what}. Screen ${obs.screen_changed ? "changed" : "did not change"} afterwards, but no expectation was given, so the intended effect is not confirmed.`);
}

export function computerTools(controller) {
  return [
    {
      name: "computer_screenshot", category: "computer", permissions: ["computer.screen"], timeout: 20,
      description: "Look at the user's screen. Returns an image (if the model supports vision) plus the cursor position and active window. All other computer_* tools use the coordinates of this screenshot. Call this before clicking, and again afterwards to check the result.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      summarize: () => "Take a screenshot of the screen",
      handler: guarded(async (a, ctx) => {
        const s = await controller.screenshot(ctx.signal);
        return {
          ...ok({ width: s.width, height: s.height, scale_from_real_screen: s.scale, real_screen: s.screen, cursor: s.cursor, active_window: s.active_window },
            "Screenshot captured.", true),
          images: [{ mime: "image/png", base64: s.png.toString("base64"), caption: `Screenshot ${s.width}x${s.height}. Coordinates for computer_* tools are in this image's pixels.` }],
        };
      }),
    },
    {
      name: "computer_list_windows", category: "computer", permissions: ["computer.screen"], timeout: 15,
      description: "List open window titles and their positions (screenshot coordinates). Not available on Linux without a window manager.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      summarize: () => "List open windows",
      handler: guarded(async (a, ctx) => {
        const windows = await controller.listWindows(ctx.signal);
        return ok({ windows, count: windows.length }, "Window list read from the OS.");
      }),
    },
    {
      name: "computer_ui_elements", category: "computer", permissions: ["computer.screen"], timeout: 25,
      description: "Windows only: list the named buttons, fields and menus of the foreground window with their centre coordinates (screenshot coordinates), so you can click exactly. Password fields are never listed.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      summarize: () => "Read the controls of the foreground window",
      handler: guarded(async (a, ctx) => {
        if (process.platform !== "win32") return fail("computer_ui_elements is only available on Windows. Use computer_screenshot instead.");
        const v = await controller.view();
        const els = (await listUiElements({ signal: ctx.signal })).map((e) => ({ name: e.name, type: e.type, ...controller.toView(v, e.x, e.y) }));
        return ok({ elements: els, count: els.length }, "Controls read via Windows UI Automation.");
      }),
    },
    {
      name: "computer_mouse_move", category: "computer", permissions: ["computer.input"], timeout: 15,
      description: "Move the mouse pointer to a point (screenshot coordinates). Verified by reading the pointer position back.",
      inputSchema: { type: "object", properties: xy, required: ["x", "y"], additionalProperties: false },
      summarize: (a) => `Move the mouse pointer to (${a.x}, ${a.y})`,
      handler: guarded(async (a, ctx) => {
        const r = await controller.move(a.x, a.y, ctx.signal);
        return r.verified ? ok(r, `Pointer read back at (${r.cursor.x}, ${r.cursor.y}).`) : { ok: false, data: r, error: `Pointer ended ${r.offset_px}px away from the target.`, recoverable: true, verified: false, verification: "" };
      }),
    },
    {
      name: "computer_click", category: "computer", permissions: ["computer.input"], timeout: 25,
      description: "Click (or double/right-click) at a point in screenshot coordinates. Pass `expect` (e.g. the window title that should appear, or screen_changes) so the click can be verified.",
      inputSchema: { type: "object", properties: { ...xy, button: { type: "string", enum: ["left", "right", "middle"] }, double: { type: "boolean" }, expect: expectSchema }, required: ["x", "y"], additionalProperties: false },
      summarize: (a) => `${a.double ? "Double-click" : a.button === "right" ? "Right-click" : "Click"} at (${a.x}, ${a.y})`,
      handler: guarded(async (a, ctx) => actionResult(await controller.click(a.x, a.y, { button: a.button, double: a.double, expect: a.expect }, ctx.signal), "Click delivered", a.expect)),
    },
    {
      name: "computer_drag", category: "computer", permissions: ["computer.input"], timeout: 30,
      description: "Press the left button at one point, drag to another and release (screenshot coordinates).",
      inputSchema: { type: "object", properties: { from_x: { type: "integer" }, from_y: { type: "integer" }, to_x: { type: "integer" }, to_y: { type: "integer" }, expect: expectSchema }, required: ["from_x", "from_y", "to_x", "to_y"], additionalProperties: false },
      summarize: (a) => `Drag from (${a.from_x}, ${a.from_y}) to (${a.to_x}, ${a.to_y})`,
      handler: guarded(async (a, ctx) => actionResult(await controller.drag({ x: a.from_x, y: a.from_y }, { x: a.to_x, y: a.to_y }, { expect: a.expect }, ctx.signal), "Drag performed", a.expect)),
    },
    {
      name: "computer_scroll", category: "computer", permissions: ["computer.input"], timeout: 20,
      description: "Scroll the mouse wheel, optionally after moving the pointer to (x, y).",
      inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "integer", minimum: 1, maximum: 50 }, ...xy, expect: expectSchema }, required: ["direction", "amount"], additionalProperties: false },
      summarize: (a) => `Scroll ${a.direction} by ${a.amount}`,
      handler: guarded(async (a, ctx) => actionResult(await controller.scroll(a.direction, a.amount, Number.isFinite(a.x) && Number.isFinite(a.y) ? { x: a.x, y: a.y } : null, { expect: a.expect }, ctx.signal), "Scroll performed", a.expect)),
    },
    {
      name: "computer_type", category: "computer", permissions: ["computer.input"], timeout: 40,
      description: "Type text into the focused control (any language; non-ASCII text such as Hindi is pasted via the clipboard). Click the target field first. Refuses terminals and the Run box. Never type passwords or secrets.",
      inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 2000 }, expect: expectSchema }, required: ["text"], additionalProperties: false },
      summarize: (a) => `Type ${a.text.length} characters: "${a.text.length > 60 ? a.text.slice(0, 60) + "…" : a.text}"`,
      handler: guarded(async (a, ctx) => actionResult(await controller.type(a.text, { expect: a.expect }, ctx.signal), "Text typed", a.expect)),
    },
    {
      name: "computer_key", category: "computer", permissions: ["computer.input"], timeout: 25,
      description: "Press a key or combination such as 'enter', 'ctrl+s', 'alt+tab', 'win' or 'f5'. Win+R, Win+X, Win+L and Ctrl+Alt+Del are blocked.",
      inputSchema: { type: "object", properties: { keys: { type: "string" }, expect: expectSchema }, required: ["keys"], additionalProperties: false },
      summarize: (a) => `Press ${a.keys}`,
      handler: guarded(async (a, ctx) => {
        try { return actionResult(await controller.key(a.keys, { expect: a.expect }, ctx.signal), "Keys pressed", a.expect); }
        catch (e) { if (/^(Unknown key|Empty key|At most|A combination|Key ')/.test(e.message)) return fail(e.message, { recoverable: true }); throw e; }
      }),
    },
    {
      name: "computer_focus_window", category: "computer", permissions: ["computer.input"], timeout: 20,
      description: "Bring the window whose title contains the given text to the front (Windows/macOS). Verified by reading the active window back.",
      inputSchema: { type: "object", properties: { title: { type: "string", minLength: 1 } }, required: ["title"], additionalProperties: false },
      summarize: (a) => `Bring the window '${a.title}' to the front`,
      handler: guarded(async (a, ctx) => {
        const r = await controller.focusWindow(a.title, ctx.signal);
        if (!r.found) return fail(`No open window has a title containing '${a.title}'.`, { recoverable: true });
        return r.focused ? ok(r, `Active window read back as '${r.active_window}'.`) : fail(`Found '${r.title}' but it did not become the active window (active: '${r.active_window}').`, { recoverable: true, data: r });
      }),
    },
    {
      name: "computer_wait", category: "computer", permissions: ["computer.screen"], timeout: 40,
      description: "Wait for an app to react: either a fixed number of milliseconds, or until the active window title contains some text (up to timeout_ms).",
      inputSchema: { type: "object", properties: { ms: { type: "integer", minimum: 100, maximum: 10000 }, window_title_contains: { type: "string" }, timeout_ms: { type: "integer", minimum: 500, maximum: 30000 } }, additionalProperties: false },
      summarize: (a) => (a.window_title_contains ? `Wait for a window titled '${a.window_title_contains}'` : `Wait ${a.ms ?? 1000} ms`),
      handler: guarded(async (a, ctx) => {
        const r = await controller.waitFor(a, ctx.signal);
        if (r.met === false) return fail(`No window titled '${a.window_title_contains}' appeared within ${r.waited_ms} ms (active: '${r.active_window}').`, { recoverable: true, data: r });
        return r.met ? ok(r, "Window title observed.") : unverified(r, "Waited; nothing was checked.");
      }),
    },
  ];
}
