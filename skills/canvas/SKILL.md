---
name: canvas
description: Use when agent-canvas channel is connected and you need to update the browser UI, show progress, display data, or collect user input via .canvas/ui-state.json
---

# agent-canvas

You have a live browser UI. Edit `.canvas/ui-state.json` to update it — changes appear instantly.

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
