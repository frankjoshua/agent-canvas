---
name: canvas
description: Update the browser UI, show progress, display data, or collect user input via .canvas/ui-state.json. Also handles starting the channel, checking connection, and troubleshooting.
---

# agent-canvas

A channel plugin that gives this session a live browser UI. You edit `.canvas/ui-state.json`, a file watcher picks up the change, and the browser updates instantly via SSE.

## Prerequisites

- **Bun** must be installed (`which bun` to check)
- The session must have been started with `--dangerously-load-development-channels` (channels are in research preview). If the session wasn't started with this flag, channels cannot connect — tell the user to restart with it.

## Is the channel running?

Check for a startup channel event in your conversation context:

```
<channel source="agent-canvas" event="startup">agent-canvas running at http://0.0.0.0:8765</channel>
```

If you see this, the channel is connected. The URL is in the message. Skip to "State file structure" below.

If you do NOT see a startup event, you must start the channel yourself. Do NOT silently write to `.canvas/ui-state.json` hoping it works — without the channel process, nothing will appear in the browser.

**Resumed sessions**: If this session was resumed (`--continue`), the channel process from the original session is gone. You need to restart it.

## Starting the channel

The plugin is installed at a known path. Start it in the background:

```bash
# 1. Find a free port (default range 8765-8770)
for p in 8765 8766 8767 8768 8769 8770; do
  curl -s --max-time 0.2 http://localhost:$p >/dev/null 2>&1 || { PORT=$p; break; }
done

# 2. Find the plugin directory
PLUGIN_DIR="$(find ~/.claude/plugins -type d -name agent-canvas -path "*/marketplaces/*" 2>/dev/null | head -1)"
# Fallback for dev: PLUGIN_DIR="/home/josh/development/workspace/agent-canvas"

# 3. Install deps if needed, then start in background
bun install --no-summary --cwd "$PLUGIN_DIR" 2>/dev/null
CANVAS_PORT=$PORT nohup bun "$PLUGIN_DIR/channel/index.ts" \
  --dev --project "$(pwd)" > /tmp/canvas-$PORT.log 2>&1 &
```

**Important**: Run `bun channel/index.ts` directly — do NOT use `start.sh` (the `exec` in it fails in some environments).

Use `--dev` mode when launching manually (it skips the stdio MCP connection which only works when Claude Code spawns the process).

### Verify it's running

```bash
# Check the log for the URL
cat /tmp/canvas-$PORT.log

# Confirm it's serving
curl -s http://localhost:$PORT | head -5
```

You should see `agent-canvas: http://0.0.0.0:<port>` in the log. Tell the user the URL so they can open it.

The server binds to `0.0.0.0` — accessible from other devices on the same network (phones, tablets, Tailscale).

## State file structure

```json
{
  "version": 1,
  "title": "Page Title",
  "theme": "dark",
  "layout": "stack",
  "components": []
}
```

- **layout**: `"stack"` (vertical), `"grid"` (2-column), or `"sidebar"` (1/3 + 2/3)
- **theme**: any DaisyUI theme name (`dark`, `light`, `cupcake`, `synthwave`, etc.)

## Component types

### `html` — the primary component

Raw HTML with full DaisyUI + Tailwind classes. Use for badges, cards, stats, tables, tabs, navbars — anything DaisyUI offers.

```json
{
  "id": "status",
  "type": "html",
  "content": "<span class='badge badge-success badge-lg'>Running</span>"
}
```

Make elements interactive with `data-input-event`:

```json
{
  "id": "actions",
  "type": "html",
  "content": "<button class='btn btn-primary' data-input-event='confirm'>Confirm</button>"
}
```

Clicking sends a channel event: `<channel source="agent-canvas" event="custom" component_id="actions" event_name="confirm">`

### `markdown` — content rendering

Renders markdown to HTML. Supports raw HTML passthrough for iframes, embeds, etc.

```json
{
  "id": "summary",
  "type": "markdown",
  "content": "## Results\n\nFound **3 issues**:\n\n- Missing null check\n- Unused import\n- Deprecated API call"
}
```

### `form` — structured input

JSON-defined form fields. Submissions arrive as channel events.

```json
{
  "id": "config",
  "type": "form",
  "title": "Settings",
  "fields": [
    {"id": "env", "label": "Environment", "type": "select", "options": ["dev", "staging", "prod"], "default": "dev"},
    {"id": "count", "label": "Count", "type": "number", "default": "5"},
    {"id": "verbose", "label": "Verbose logging", "type": "checkbox", "default": true},
    {"id": "notes", "label": "Notes", "type": "textarea", "placeholder": "Optional..."}
  ],
  "submitLabel": "Apply"
}
```

Field types: `text`, `textarea`, `number`, `select`, `checkbox`, `radio`, `range`, `date`

Submission arrives as: `<channel source="agent-canvas" event="form_submit" component_id="config">{"env": "staging", "count": "10", ...}</channel>`

### `log` — append-only log panel

```json
{
  "id": "build-log",
  "type": "log",
  "title": "Build Output",
  "entries": [
    {"level": "info", "message": "Starting..."},
    {"level": "success", "message": "Done"},
    {"level": "warning", "message": "3 deprecations"},
    {"level": "error", "message": "Test failed"}
  ],
  "maxLines": 100,
  "autoscroll": true
}
```

Append entries by writing the full array with new items at the end.

## Local files

Reference local files via `/files/` + absolute path:

```json
{"type": "html", "content": "<img src='/files/home/josh/images/photo.png' class='rounded-lg'>"}
```

## Design

The UI uses DaisyUI + Tailwind from CDN. Make it look intentional, not default.

- **Theme**: Pick a DaisyUI theme that fits the project mood. `dark` is safe, `synthwave` or `cyberpunk` for personality, `corporate` or `lofi` for clean utility.
- **Layout**: Use the `grid` layout with DaisyUI `stats` components for dashboards. Use `sidebar` to keep navigation persistent. Mix component types — a markdown summary next to an html stats card is more readable than all-markdown.
- **Hierarchy**: Lead with the most important information. Use DaisyUI badges for status, `text-2xl` or `stat-value` for key numbers, muted `text-base-content/60` for secondary info.
- **Cards**: Wrap related content in `card bg-base-200 shadow-lg` to create visual grouping. Use `card-actions` for buttons.
- **Spacing**: The page has a max-width container with `px-6 md:px-10` side padding. Components are spaced with `gap-4` by the layout. Inside cards, use `card-body` (has built-in padding) or `p-6` for content areas. Prefer generous whitespace — `gap-6` between sections, `gap-3` between items within a section. Breathing room between elements looks polished; cramped layouts look broken.
- **Color with purpose**: DaisyUI variants (`success`, `error`, `warning`, `info`, `primary`, `secondary`, `accent`) carry meaning. Use them to communicate status, not decoration.

## Tips

- Set `"visible": false` on any component to hide it without removing from state
- Unknown component types are silently ignored
- Write the complete state file each time — the plugin re-renders everything on change
- DaisyUI components work out of the box: badges, cards, stats, tables, steps, alerts, tabs, navbars, drawers, etc.
- For multi-view UIs, use DaisyUI tabs with radio buttons (pure CSS, no round-trip needed)
