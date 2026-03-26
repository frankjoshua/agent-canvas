# agent-canvas

A Claude Code channel plugin that gives a running session a live browser UI. Claude writes a JSON file, and the browser updates instantly.

## Install

```bash
bun add agent-canvas
```

## Usage

### With Claude Code

```bash
claude --dangerously-load-development-channels server:bunx agent-canvas
```

The plugin watches `.canvas/ui-state.json` in your project and pushes changes to a browser tab via SSE. User interactions (button clicks, form submissions) flow back to Claude as channel events.

### Dev mode (without Claude Code)

```bash
bunx agent-canvas --dev --project /path/to/your-project
```

Runs the HTTP server and file watcher only. Edit `.canvas/ui-state.json` by hand and see the browser update live. Useful for testing layouts.

### Network access

The server binds to `0.0.0.0` by default — accessible from any device on the same network (phones, tablets, other machines via Tailscale, etc.). Override with `CANVAS_HOST` if needed.

## State file

Create `.canvas/ui-state.json` in your project:

```json
{
  "version": 1,
  "title": "My Dashboard",
  "theme": "dark",
  "layout": "stack",
  "components": [
    {
      "id": "greeting",
      "type": "html",
      "content": "<div class='card bg-base-200'><div class='card-body'><h2 class='card-title'>Hello</h2><p>Edit this file to update the UI.</p></div></div>"
    }
  ]
}
```

### Component types

- **`html`** -- raw HTML with full DaisyUI + Tailwind classes
- **`markdown`** -- renders markdown to HTML, supports raw HTML passthrough
- **`form`** -- structured input form, submissions flow back as channel events
- **`log`** -- scrolling append-only log panel

### User interaction

Add `data-input-event` to any element in an `html` component to make it interactive:

```html
<button class="btn btn-primary" data-input-event="confirm">Confirm</button>
```

Clicks send a channel event to Claude with the event name and parent component ID.

## Multiple instances

Each session gets its own port. The plugin auto-increments from the default if a port is in use. The URL is printed to stderr and injected into the Claude Code session on startup.

## Requirements

- [Bun](https://bun.sh)
- Claude Code v2.1.80+ (for channel support)
- `--dangerously-load-development-channels` flag (channels are in research preview)
