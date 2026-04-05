---
name: canvas
description: Update the browser UI, show progress, display data, or collect user input via .canvas/ui-state.json. Also handles checking connection, starting the channel, and troubleshooting.
---

# agent-canvas

A channel plugin that gives this session a live browser UI. You edit `.canvas/ui-state.json`, a file watcher picks up the change, and the browser updates instantly via SSE.

## Is the channel connected?

Look for a channel event from `agent-canvas` in your conversation context. The channel sends a startup notification when it connects:

```
<channel source="agent-canvas" ...>agent-canvas running at http://0.0.0.0:8765</channel>
```

**If you see a channel event from agent-canvas**: The channel is connected. Get the port from the message, then give the user the Tailscale FQDN URL (see "Giving the user the URL" below). Skip to "State file structure".

**If you do NOT see any agent-canvas channel events**: The channel is not running. Do NOT silently write to `.canvas/ui-state.json` hoping it works — without the channel process, nothing appears in the browser. Follow the steps below.

## How the channel normally starts

When the plugin is properly installed, Claude Code handles everything:

1. Claude Code reads the plugin's `.mcp.json` at session startup
2. It spawns `bash start.sh` which runs `bun channel/index.ts`
3. The channel connects via stdio MCP transport and declares `claude/channel` capability
4. It sends a startup notification that appears as a channel event in conversation
5. It starts watching `.canvas/ui-state.json` for changes

This requires:
- **Plugin installed**: `claude plugin install agent-canvas` (installs to `~/.claude/plugins/`)
- **Channels enabled**: Session started with `--channels plugin:agent-canvas@agent-canvas-marketplace`
- **For custom/dev plugins**: Add `--dangerously-load-development-channels` flag (channels are in research preview)
- **Bun installed**: The channel server runs on [Bun](https://bun.sh)

## Starting the channel manually (fallback)

If the channel isn't connected — plugin not installed, session resumed (`--continue` loses channel processes), or channels not enabled — you can start it in dev mode.

Run the startup script:

```bash
# Find the plugin directory
PLUGIN_DIR="$(find ~/.claude/plugins -type d -name agent-canvas -path '*/marketplaces/*' 2>/dev/null | head -1)"

# Start canvas (finds free port, starts in background, verifies)
bash "$PLUGIN_DIR/scripts/canvas-start.sh" --project "$(pwd)"
```

The script:
- Scans ports 8765-8770 for a free one
- Installs dependencies if needed
- Starts the server in background with `nohup`
- Verifies the process is running and responding
- Prints the Tailscale FQDN URL and PID

Tell the user the URL from the script output.

## Giving the user the URL

Always provide the Tailscale FQDN link — it works from any device on the tailnet (phones, tablets, other machines):

```bash
FQDN=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName' | sed 's/\.$//')
echo "http://${FQDN}:${PORT}"
```

The startup script prints this automatically. If the channel auto-started, extract the port from the channel event and run the snippet above.

Example: `http://josh-office.stork-spica.ts.net:8765`

**Dev mode note**: Manual launch uses `--dev` which skips the MCP stdio connection. The UI works fully (file watching, SSE, forms, buttons) but user interactions won't arrive as channel events in your conversation — they only flow through the HTTP server.

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
