#!/usr/bin/env bun
/**
 * agent-canvas — Claude Code channel plugin
 *
 * Watches .canvas/ui-state.json and pushes a live browser UI.
 * User interactions flow back to Claude as channel events.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync, writeFileSync, existsSync, copyFileSync, watchFile, statSync } from 'fs'
import { join, resolve } from 'path'
import { marked } from 'marked'

// --- Configuration ---

const DEFAULT_PORT = 8765
const DEBOUNCE_MS = 50

const isDev = process.argv.includes('--dev')
const projectArg = process.argv.findIndex(a => a === '--project')
const projectRoot = projectArg !== -1 && process.argv[projectArg + 1]
  ? resolve(process.argv[projectArg + 1])
  : process.cwd()

const stateDir = join(projectRoot, '.canvas')
const statePath = join(stateDir, 'ui-state.json')
const defaultPath = join(stateDir, 'ui-default.json')

// --- Types ---

interface Component {
  id: string
  type: string
  visible?: boolean
  content?: string
  // form fields
  title?: string
  fields?: FormField[]
  submitLabel?: string
  // log fields
  entries?: LogEntry[]
  maxLines?: number
  autoscroll?: boolean
  [key: string]: unknown
}

interface FormField {
  id: string
  label: string
  type: string
  options?: string[]
  default?: unknown
  placeholder?: string
}

interface LogEntry {
  level: string
  message: string
}

interface UIState {
  version?: number
  title?: string
  theme?: string
  layout?: string
  autoOpen?: boolean
  components: Component[]
}

// --- State Management ---

let currentState: UIState = { components: [] }
let previousState: UIState = { components: [] }

function readState(): UIState {
  try {
    const raw = readFileSync(statePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { components: [] }
  }
}

function ensureState(): void {
  if (!existsSync(stateDir)) {
    const { mkdirSync } = require('fs')
    mkdirSync(stateDir, { recursive: true })
  }
  if (!existsSync(statePath)) {
    if (existsSync(defaultPath)) {
      copyFileSync(defaultPath, statePath)
    } else {
      writeFileSync(statePath, JSON.stringify({
        version: 1,
        title: 'agent-canvas',
        theme: 'dark',
        layout: 'stack',
        autoOpen: true,
        components: []
      }, null, 2))
    }
  }
  currentState = readState()
  previousState = { ...currentState }
}

// --- Component Rendering ---

function renderComponent(comp: Component): string {
  if (comp.visible === false) return ''

  switch (comp.type) {
    case 'html':
      return `<div id="${comp.id}" class="component">${comp.content ?? ''}</div>`

    case 'markdown':
      return `<div id="${comp.id}" class="component prose max-w-none">${marked.parse(comp.content ?? '', { async: false })}</div>`

    case 'form':
      return renderForm(comp)

    case 'log':
      return renderLog(comp)

    default:
      return '' // Unknown types silently ignored
  }
}

function renderForm(comp: Component): string {
  const fields = (comp.fields ?? []).map(f => {
    switch (f.type) {
      case 'text':
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><input type="text" name="${f.id}" class="input input-bordered w-full" placeholder="${f.placeholder ?? ''}" value="${f.default ?? ''}"></div>`
      case 'textarea':
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><textarea name="${f.id}" class="textarea textarea-bordered w-full" placeholder="${f.placeholder ?? ''}">${f.default ?? ''}</textarea></div>`
      case 'number':
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><input type="number" name="${f.id}" class="input input-bordered w-full" value="${f.default ?? ''}"></div>`
      case 'select':
        const opts = (f.options ?? []).map(o => `<option${o === f.default ? ' selected' : ''}>${o}</option>`).join('')
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><select name="${f.id}" class="select select-bordered w-full">${opts}</select></div>`
      case 'checkbox':
        return `<div class="form-control"><label class="label cursor-pointer gap-4"><span class="label-text">${f.label}</span><input type="checkbox" name="${f.id}" class="checkbox" ${f.default ? 'checked' : ''}></label></div>`
      case 'radio':
        const radios = (f.options ?? []).map(o => `<label class="label cursor-pointer gap-2"><span class="label-text">${o}</span><input type="radio" name="${f.id}" value="${o}" class="radio" ${o === f.default ? 'checked' : ''}></label>`).join('')
        return `<div class="form-control"><span class="label-text font-medium">${f.label}</span>${radios}</div>`
      case 'range':
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><input type="range" name="${f.id}" class="range" value="${f.default ?? 50}"></div>`
      case 'date':
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><input type="date" name="${f.id}" class="input input-bordered w-full" value="${f.default ?? ''}"></div>`
      default:
        return `<div class="form-control w-full"><label class="label"><span class="label-text">${f.label}</span></label><input type="text" name="${f.id}" class="input input-bordered w-full"></div>`
    }
  }).join('\n')

  return `<div id="${comp.id}" class="component"><div class="card bg-base-200"><div class="card-body"><h2 class="card-title">${comp.title ?? 'Form'}</h2><form class="flex flex-col gap-2" data-component-id="${comp.id}" onsubmit="submitForm(event)">${fields}<button type="submit" class="btn btn-primary mt-2">${comp.submitLabel ?? 'Submit'}</button></form></div></div></div>`
}

function renderLog(comp: Component): string {
  const entries = (comp.entries ?? []).slice(-(comp.maxLines ?? 100))
  const lines = entries.map(e => {
    const color = e.level === 'error' ? 'text-error'
      : e.level === 'warning' ? 'text-warning'
      : e.level === 'success' ? 'text-success'
      : 'text-base-content'
    return `<div class="${color}"><span class="opacity-50">[${e.level}]</span> ${e.message}</div>`
  }).join('')

  return `<div id="${comp.id}" class="component"><div class="card bg-base-200"><div class="card-body"><h2 class="card-title">${comp.title ?? 'Log'}</h2><div class="font-mono text-sm bg-base-300 rounded-lg p-4 max-h-96 overflow-y-auto"${comp.autoscroll !== false ? ' data-autoscroll="true"' : ''}>${lines}</div></div></div></div>`
}

function renderAllComponents(state: UIState): string {
  const layoutClass = state.layout === 'grid'
    ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
    : state.layout === 'sidebar'
    ? 'grid grid-cols-1 md:grid-cols-3 gap-6'
    : 'flex flex-col gap-6'

  const components = state.components.map((comp, i) => {
    const html = renderComponent(comp)
    if (!html) return ''
    if (state.layout === 'sidebar' && i === 0) {
      return `<div class="md:col-span-1">${html}</div>`
    }
    if (state.layout === 'sidebar' && i === 1) {
      // Wrap remaining components in main area
      const rest = state.components.slice(1).map(c => renderComponent(c)).filter(Boolean).join('\n')
      return `<div class="md:col-span-2 flex flex-col gap-4">${rest}</div>`
    }
    if (state.layout === 'sidebar' && i > 1) {
      return '' // Already rendered in the sidebar main area
    }
    return html
  }).filter(Boolean).join('\n')

  return `<div id="component-root" class="${layoutClass}">${components}</div>`
}

// --- SSE ---

const sseClients = new Set<ReadableStreamDefaultController>()

function pushToClients(html: string): void {
  const data = `data: ${JSON.stringify(html)}\n\n`
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(data))
    } catch {
      sseClients.delete(controller)
    }
  }
}

// Keepalive ping every 30s to prevent connection timeout
setInterval(() => {
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
    } catch {
      sseClients.delete(controller)
    }
  }
}, 30_000)

// --- File Watcher ---

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onFileChange(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const newState = readState()
    if (JSON.stringify(newState) === JSON.stringify(currentState)) return

    previousState = currentState
    currentState = newState

    const html = renderAllComponents(currentState)
    pushToClients(html)
  }, DEBOUNCE_MS)
}

function startWatcher(): void {
  // Use fs.watchFile for reliability (works across all platforms)
  watchFile(statePath, { interval: 100 }, () => {
    onFileChange()
  })
}

// --- HTTP Server ---

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const test = Bun.serve({
      port: start,
      hostname: process.env.CANVAS_HOST ?? '127.0.0.1',
      fetch() { return new Response('') },
    })
    const port = test.port
    test.stop()
    resolve(port)
  })
}

async function startHttpServer(): Promise<number> {
  const host = process.env.CANVAS_HOST ?? '127.0.0.1'
  let port = Number(process.env.CANVAS_PORT ?? DEFAULT_PORT)

  const server = Bun.serve({
    port,
    hostname: host,
    fetch(req) {
      const url = new URL(req.url)

      // Serve the browser page
      if (url.pathname === '/') {
        return new Response(getPageHtml(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }

      // SSE stream
      if (url.pathname === '/events') {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller)
            // Send initial state
            const html = renderAllComponents(currentState)
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(html)}\n\n`))
          },
          cancel(controller) {
            sseClients.delete(controller)
          },
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
            'access-control-allow-origin': '*',
          },
        })
      }

      // Current state as JSON
      if (url.pathname === '/state') {
        return new Response(JSON.stringify(currentState), {
          headers: { 'content-type': 'application/json' },
        })
      }

      // User input from browser
      if (url.pathname === '/input' && req.method === 'POST') {
        return (async () => {
          try {
            const payload = await req.json()
            deliverInput(payload)
          } catch {}
          return new Response(null, { status: 202 })
        })()
      }

      // Serve local files
      if (url.pathname.startsWith('/files/')) {
        const filePath = '/' + url.pathname.slice(7)
        try {
          if (filePath.includes('..')) return new Response('bad path', { status: 400 })
          const data = readFileSync(filePath)
          const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
          return new Response(data, {
            headers: { 'content-type': getMime(ext) },
          })
        } catch {
          return new Response('not found', { status: 404 })
        }
      }

      return new Response('not found', { status: 404 })
    },
  })

  port = server.port
  process.stderr.write(`agent-canvas: http://${host}:${port}\n`)
  return port
}

function getMime(ext: string): string {
  const types: Record<string, string> = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
    webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4',
    webm: 'video/webm', txt: 'text/plain',
  }
  return types[ext] ?? 'application/octet-stream'
}

// --- MCP Channel ---

let mcp: Server | null = null

function deliverInput(payload: Record<string, unknown>): void {
  if (!mcp) return

  const event = payload.event as string ?? 'custom'
  const componentId = payload.componentId as string ?? ''
  const meta: Record<string, string> = {
    event,
    component_id: componentId,
  }

  let content = ''

  if (event === 'form_submit') {
    content = `Form submitted: ${componentId}\n${JSON.stringify(payload.data ?? {})}`
    meta.component_id = componentId
  } else if (event === 'custom') {
    const eventName = payload.eventName as string ?? ''
    meta.event_name = eventName
    content = `User clicked ${eventName} on ${componentId}`
  }

  void mcp.notification({
    method: 'notifications/claude/channel',
    params: { content, meta },
  })
}

// --- Browser HTML ---

function getPageHtml(): string {
  const title = currentState.title ?? 'agent-canvas'
  const theme = currentState.theme ?? 'dark'

  return `<!DOCTYPE html>
<html data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.css" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com/3.4"></script>
</head>
<body class="bg-base-300 min-h-screen">
  <div class="max-w-5xl mx-auto px-6 md:px-10 py-6 md:py-8">
    <header class="mb-6">
      <h1 id="page-title" class="text-2xl font-bold text-base-content">${title}</h1>
    </header>
    <div id="canvas"></div>
  </div>

  <div id="error-banner" style="display:none" class="fixed top-4 right-4 alert alert-error shadow-lg max-w-md z-50">
    <span id="error-text"></span>
    <button class="btn btn-sm btn-ghost" onclick="this.parentElement.style.display='none'">dismiss</button>
  </div>

  <script>
    // SSE connection
    let evtSource = null

    function connect() {
      evtSource = new EventSource('/events')
      evtSource.onmessage = (e) => {
        try {
          const html = JSON.parse(e.data)
          document.getElementById('canvas').innerHTML = html
          bindInputEvents()
          autoScrollLogs()
        } catch (err) {
          console.error('SSE parse error:', err)
        }
      }
      // EventSource auto-reconnects on error — no manual close needed
    }

    // Bind data-input-event click handlers
    function bindInputEvents() {
      document.querySelectorAll('[data-input-event]').forEach(el => {
        if (el._bound) return
        el._bound = true
        el.addEventListener('click', () => {
          const eventName = el.getAttribute('data-input-event')
          const component = el.closest('.component')
          const componentId = component ? component.id : ''
          fetch('/input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'custom',
              componentId,
              eventName,
            })
          })
        })
      })
    }

    // Form submission handler
    window.submitForm = function(e) {
      e.preventDefault()
      const form = e.target
      const componentId = form.getAttribute('data-component-id')
      const formData = new FormData(form)
      const data = {}
      for (const [key, value] of formData.entries()) {
        data[key] = value
      }
      // Handle checkboxes (unchecked ones aren't in FormData)
      form.querySelectorAll('input[type=checkbox]').forEach(cb => {
        data[cb.name] = cb.checked
      })
      fetch('/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'form_submit',
          componentId,
          data,
        })
      })
    }

    // Auto-scroll log panels
    function autoScrollLogs() {
      document.querySelectorAll('[data-autoscroll="true"]').forEach(el => {
        el.scrollTop = el.scrollHeight
      })
    }

    // Start
    connect()
  </script>
</body>
</html>`
}

// --- Main ---

async function main() {
  ensureState()
  const port = await startHttpServer()
  startWatcher()

  if (!isDev) {
    // Connect MCP channel
    mcp = new Server(
      { name: 'agent-canvas', version: '0.0.1' },
      {
        capabilities: {
          experimental: { 'claude/channel': {} },
        },
        instructions: `You have a live browser UI connected to this session via .canvas/ui-state.json. Edit that file to update the UI — changes appear in the browser instantly. Component types: html (raw DaisyUI/Tailwind HTML), markdown, form, log. User interactions arrive as <channel source="agent-canvas"> events. The UI is at http://${process.env.CANVAS_HOST ?? '127.0.0.1'}:${port}`,
      },
    )
    await mcp.connect(new StdioServerTransport())

    // Notify Claude of the URL
    void mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: `agent-canvas running at http://${process.env.CANVAS_HOST ?? '127.0.0.1'}:${port}`,
        meta: { event: 'startup' },
      },
    })
  }
}

main().catch(err => {
  process.stderr.write(`agent-canvas error: ${err}\n`)
  process.exit(1)
})
