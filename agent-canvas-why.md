# agent-canvas — Design Decisions

> This document explains the reasoning behind every significant architectural and technology
> choice in agent-canvas. It exists so that Claude Code — and future contributors — understand
> not just what was built, but why, and specifically what alternatives were considered and
> rejected. When something looks like it could be simplified or refactored toward a more
> "obvious" pattern, check here first.

---

## The core premise: Claude should not know it has a UI

The most important decision in the entire project is not a technology choice — it is a
design philosophy.

Claude Code is a capable agent. It can call tools, write files, read files, and respond to
events. We deliberately chose not to expose UI interaction as a special tool Claude must learn
to call. Instead, Claude writes a JSON file — something it already knows how to do — and the
plugin translates that into a live browser UI automatically.

**Why this matters:**

- Claude does not need project-specific instructions to use the UI. Any Claude Code session
  pointed at a project with a `ui-state.json` will naturally update it as part of normal
  file-editing behaviour.
- It degrades gracefully. If the channel plugin is not running, the JSON file just sits there.
  Nothing breaks. Claude does not get confused or error out trying to call a missing tool.
- It is auditable. The state file is a plain JSON document in the project. You can read it,
  diff it, commit it, and understand exactly what the UI showed at any point in time.
- It keeps Claude's context clean. Claude is not burning tokens describing UI operations.
  It is writing data, which is what agents are good at.

**What we rejected:** Giving Claude a `render_ui` tool it must call explicitly. This would
work, but it creates a tight coupling — Claude must know the tool exists, must be instructed
to use it, and if the tool is unavailable the session breaks rather than degrades. It also
means every project needs CLAUDE.md instructions teaching Claude the tool's schema. The file
approach pushes all of that complexity into the plugin and out of the agent's head.

---

## Why a JSON file for state, not a REST endpoint

The obvious mechanism for an agent to push UI updates is a REST call: `POST /render` with a
payload. We considered this and rejected it for several reasons.

**The file is the state, not a transport.** A POST to `/render` is fire-and-forget — once
it is sent, the state only lives in the server's memory. If the browser refreshes, if the
plugin restarts, if you want to inspect what the UI looked like mid-session, the state is
gone. A JSON file is persistent. The browser can always reconstruct its full state by reading
the file on load. The plugin can restart and pick up exactly where it left off.

**It is version-controllable.** A `ui-default.json` committed to the repo is a living
document that describes what the UI should look like for this project. You can review it in a
PR, roll it back, and use it to onboard new team members to the workflow the project expects.
None of that is possible with REST calls.

**Claude already knows how to write files.** Introducing a REST call means introducing either
a new MCP tool or a `curl` invocation — both require Claude to be aware of agent-canvas
specifically. File editing is universal. Claude writes files constantly. The cognitive load on
the agent is zero.

**It enables the per-project default pattern.** Because state is a file, projects can ship
a `ui-default.json` that defines their specific widget layout. The plugin copies it to
`ui-state.json` on session start. This is not possible with a stateless REST transport.

**What we rejected:** `POST /render` with an HTML or JSON payload. Clean and familiar, but
stateless and requires explicit agent awareness. Also rejected: a SQLite database as state
store — more robust but massively over-engineered for a single-session local tool.

---

## Why Claude Code Channels, not MCP tools

MCP tools would be the natural first instinct here. You define a `render_ui` tool and a
`wait_for_input` tool, Claude calls them, done. We specifically designed around this pattern.

**Channels are push, not pull.** MCP tools are synchronous request-response. When Claude
calls `wait_for_input`, it blocks until the tool returns. This is exactly the blocking model
we rejected for being fragile and unnatural for an async agent workflow. Channels invert
the model — user input arrives as an event injected into the session whenever the user acts,
and Claude handles it in the flow of the conversation without ever having called a waiting
tool.

**Channels are designed for bidirectional external events.** The Channels protocol exists
specifically to push events from non-Claude sources into a running session. That is precisely
what user interactions from a browser are: external events that need to reach the agent.
Using MCP tools for this would be working against the grain of the protocol.

**The file handles the Claude-to-browser direction.** MCP tools solve both directions, but
once we chose a file for Claude-to-browser, the only thing MCP tools were solving was
browser-to-Claude. Channels solve that more naturally and without blocking.

**What we rejected:** A `render_ui(json)` MCP tool for Claude-to-browser plus a
`wait_for_input()` blocking tool for browser-to-Claude. This is the most intuitive design
and would have worked, but the blocking `wait_for_input` was the dealbreaker. We also
rejected pure REST polling (Claude polls a `/pending-input` endpoint in a loop) as too noisy
and likely to eat context tokens.

---

## Why HTMX, not React or Vue

The browser UI needs to update dynamically when SSE events arrive and post user interactions
back to the server. The instinctive choice for a dynamic web UI in 2026 is a JavaScript
framework — React, Vue, Svelte.

**There is no application state to manage.** Frameworks like React exist to synchronise a
complex client-side state model with the DOM. Our state lives in `ui-state.json` on disk.
The browser is a view, not a state owner. React's entire value proposition — useState,
useEffect, reconciliation — is solving a problem we do not have.

**No build step.** React requires a bundler. That is a `node_modules` folder, a webpack or
Vite config, a build command, and a dev server. For a developer tool that should be runnable
with `bun channel/index.ts`, a build pipeline is unacceptable overhead. HTMX is a single
script tag from a CDN.

**HTMX is a perfect fit for SSE-driven DOM swaps.** HTMX's `hx-swap-oob` attribute is
designed exactly for out-of-band partial DOM replacement — the pattern where the server
pushes HTML fragments that replace specific elements by ID. This is precisely what
agent-canvas does. We are not fighting HTMX to make it work; we are using its core feature.

**The server renders HTML, not JSON.** Because the plugin's renderer converts JSON state to
HTML fragments, the browser never needs to interpret data — it receives ready-to-render HTML
and HTMX swaps it in. This keeps the browser page minimal: no component logic, no data
binding, no templating.

**What we rejected:** React with a REST/WebSocket data layer. Would work but requires a
build step and puts component logic in the browser that belongs in the plugin's renderer.
Also rejected: vanilla JS with `innerHTML` — simpler than React but requires writing DOM
manipulation code that HTMX gives us for free.

---

## Why DaisyUI as the component library

We needed a rich component library that works without a build step, looks good out of the
box, and covers the component vocabulary agents naturally reach for: badges, progress bars,
tables, cards, forms, alerts, steps.

**DaisyUI works from a CDN.** Most UI frameworks assume a build pipeline. DaisyUI distributes
a prebuilt CSS file that includes all component styles. A single link tag is all that is
needed. No PostCSS, no purge configuration, no build step.

**It is Tailwind-compatible.** The agent-canvas renderer generates Tailwind utility classes
alongside DaisyUI component classes. This means Claude can describe layout and spacing
naturally (w-full, gap-4, p-6) without learning a custom layout API.

**The component vocabulary maps cleanly to what agents produce.** DaisyUI's components —
badge, progress, card, stat, alert, steps, table — are exactly the kinds of UI elements an
agent naturally reaches for when communicating status, data, and decision points. There is
very little translation needed between "what Claude wants to express" and "what DaisyUI can
render."

**It supports theming out of the box.** The `data-theme` attribute on `<html>` switches the
entire UI theme. Claude can change the theme by writing a single field to `ui-state.json`.
This requires zero additional code in the plugin.

**What we rejected:** shadcn/ui — requires a build pipeline and React, disqualified
immediately. Bootstrap — dated aesthetic, not Tailwind-compatible. Plain Tailwind with no
component library — more work in the renderer for worse results. Shoelace (Web Components) —
technically excellent but HTMX and Web Components have friction around custom element
lifecycle and SSE-driven swaps.

---

## Why SSE for browser push, not WebSockets

The plugin needs to push state diffs from the server to the browser. WebSockets are the
instinctive choice for real-time browser communication.

**SSE is unidirectional and that is correct here.** The server-to-browser channel is
one-directional: the plugin pushes HTML fragments, the browser renders them. There is no
browser-to-server data going back over this channel — that goes over the `/input` POST
endpoint. WebSockets are bidirectional, which is a capability we do not need in this
direction and which adds connection management complexity.

**SSE requires no client library.** The browser's built-in `EventSource` API handles SSE
connections, reconnections, and message parsing. There is nothing to install. HTMX has
built-in SSE support via `hx-ext="sse"`, so the browser page needs zero JavaScript to
handle incoming updates.

**SSE reconnects automatically.** If the plugin restarts, `EventSource` will automatically
reconnect. WebSockets do not reconnect without client-side logic. For a developer tool that
might be restarted frequently during development, automatic reconnection is valuable.

**Bun's HTTP server handles SSE natively.** `Bun.serve` supports streaming responses with
no additional packages. WebSockets work too, but SSE is simpler to implement and debug —
the stream is visible in browser devtools as plain text events.

**What we rejected:** WebSockets — more capable than needed, requires explicit reconnection
logic on the client, and introduces a stateful connection that complicates plugin restart.
Also rejected: long-polling — works but hammers the server with repeated requests and
introduces latency.

---

## Why no blocking input model

The original framing of this problem involved `wait_for_input` — Claude asks for input, the
call blocks until the user responds, Claude gets the answer and continues. This is intuitive
and maps to how you would write a synchronous script.

**Blocking is fragile for long-running agent sessions.** If Claude is blocked waiting for
input and the session hits a context limit, crashes, or is interrupted, the block never
resolves. The agent is frozen. The user has no visibility into what is happening or why.

**It does not match how Claude Code actually works.** Claude Code is event-driven, not
procedural. It responds to messages, tool results, and channel events. Trying to impose a
blocking procedural model on top of an event-driven runtime creates impedance mismatch.

**Async is more powerful.** With the event model, Claude can send a form to the browser,
continue doing other work (running tests, analysing files), and handle the form submission
when it arrives — without having been frozen waiting for it. This is a materially better
user experience and a more capable agent workflow.

**Input arrives as a natural channel event.** When the user submits a form, Claude receives
a message like any other channel event. It reads the message, updates its plan, and
continues. This is the exact model the Channels protocol was designed for.

**What we rejected:** A blocking `wait_for_input()` MCP tool. Intuitive, easy to explain,
maps to procedural mental models — but fragile and architecturally misaligned with how
Claude Code sessions work.

---

## Why per-project `ui-default.json`

Projects have different UI needs. A code review workflow wants a diff table and an approval
card. A deploy pipeline wants a progress stepper and a log panel. A data analysis task wants
stat cards and a results table. There is no sensible global default that serves all of these.

**The default file lets projects define their expected UI contract.** A `ui-default.json`
committed to `.claude/` is a first-class project artifact that says: when an agent session
starts on this project, this is the UI it should work with. This is the same philosophy as
`CLAUDE.md` — project-specific context that shapes how the agent behaves.

**It avoids a blank canvas on every session start.** Without a default, every session starts
with an empty UI and Claude must build the layout from scratch before doing any real work.
With a default, the UI is immediately in a useful state and Claude only needs to update
values, not build structure.

**It is optional.** Projects that do not provide a `ui-default.json` get a minimal blank
canvas. The plugin does not require the file to exist.

**What we rejected:** A global config file in `~/.claude/` — ignores per-project context.
Generating a default UI dynamically from CLAUDE.md — clever but fragile and requires Claude
to burn context on UI setup before the actual task begins.

---

## Why localhost only, no authentication

agent-canvas binds its HTTP server to `127.0.0.1` only. There is no API key, no session
token, no auth layer.

**The threat model is a local developer tool.** agent-canvas is used by a single developer
on their own machine during a Claude Code session. The browser that connects to it is running
on the same machine. Any process that can reach `localhost:8765` already has access to the
developer's machine, files, and Claude session — authentication on the HTTP server adds no
meaningful security boundary in this environment.

**Auth adds friction with no benefit.** Adding a token means generating one, storing it,
passing it to the browser, and handling expiry. For a local dev tool this is pure overhead
that makes setup harder and fails in ways that are confusing to debug.

**Network exposure is an explicit non-goal.** The spec is clear that agent-canvas is not
safe to expose on a network interface. This is documented as a constraint, not an oversight.
Developers who want remote access should use Claude Code's built-in Remote Control or
Channels features, which have proper security models.

**What we rejected:** A startup-generated token passed as a query parameter to the browser
URL. Technically correct but adds complexity for a threat that does not exist in the intended
deployment environment.

---

## Why Bun as the runtime

The Claude Code channel plugin system uses Bun. The official Telegram and Discord channel
plugins are Bun scripts. This is not a choice we made — it is a constraint of the platform.

That said, Bun is a good fit independently: it runs TypeScript directly without a compile
step, its built-in HTTP server handles SSE cleanly, and its file system APIs are fast and
ergonomic. There is no webpack, no ts-node, no separate compilation pass.

**What we rejected:** Node.js — works for the HTTP server and file watcher but requires
`ts-node` or a compile step for TypeScript, and the channel plugin system prefers Bun. Deno —
also supported by the channel protocol but less common in the Claude Code plugin ecosystem.

---

## What Claude Code should never change

These are the decisions most likely to be "helpfully" refactored away. They should not be.

**Do not add a `render_ui` MCP tool.** The file-based state mechanism is intentional. Adding
a tool creates a second path for UI updates that diverges from the file, making state
management ambiguous and breaking the "Claude doesn't need to know" principle.

**Do not make `/input` blocking.** If the implementation of `POST /input` starts holding the
HTTP response open waiting for Claude to reply, you are rebuilding the blocking model. The
endpoint should return `202 Accepted` immediately and let the channel event propagate
asynchronously.

**Do not move component rendering to the browser.** The renderer that converts JSON component
definitions to HTML belongs in the plugin, not in client-side JavaScript. If rendering moves
to the browser, you lose the zero-JS-framework property and introduce a React/Vue dependency.

**Do not replace SSE with WebSockets for the push channel.** The server-to-browser push is
one-directional. SSE is correct for one-directional push. WebSockets are not wrong but they
are more complex than needed and the automatic reconnection behaviour of SSE is valuable.

**Do not add authentication to the localhost server.** See the security section above. If
someone requests this, point them to Claude Code's Remote Control feature instead.
