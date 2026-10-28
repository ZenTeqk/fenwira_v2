import { type DraftGraph } from '@fenwira/contracts'
import type { Page } from '@playwright/test'
import { mockFrontend } from './frontend-fixture'

export const canvasGraph: DraftGraph = {
  nodes: [
    {
      id: 'trigger',
      type: 'trigger.keyword',
      config: { keywords: ['hello'], match: 'CONTAINS', caseSensitive: false },
    },
    { id: 'message', type: 'action.send_message', config: { text: 'Hello {{contact.name}}!' } },
    { id: 'end', type: 'action.end', config: {} },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'message', sourceHandle: 'next' },
    { id: 'e2', source: 'message', target: 'end', sourceHandle: 'next' },
  ],
  layout: { trigger: { x: 0, y: 0 }, message: { x: 0, y: 190 }, end: { x: 0, y: 380 } },
}

export async function mockCanvas(page: Page, graph: DraftGraph = structuredClone(canvasGraph)) {
  await mockFrontend(page)
  const flow = {
    id: 'canvas-fixture',
    name: 'Welcome flow',
    description: null,
    status: 'DRAFT',
    priority: 100,
    reentryPolicy: 'ALWAYS',
    activeVersion: null,
    executions: { total: 0, running: 0 },
    createdAt: new Date().toISOString(),
  }
  const state = { graph, saves: 0, publishes: 0, failSave: false }
  await page.route('**/api/v1/flows**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const method = route.request().method()
    if (path.endsWith('/draft') && method === 'PUT') {
      if (state.failSave) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'INTERNAL', message: 'Unavailable' } },
        })
        return
      }
      state.graph = route.request().postDataJSON().graph
      state.saves++
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (path.endsWith('/publish')) {
      state.publishes++
      flow.status = 'ACTIVE'
    }
    if (method === 'PATCH') Object.assign(flow, route.request().postDataJSON())
    const data = path.endsWith('/draft')
      ? { graph: state.graph, etag: `"draft-${state.saves}"`, validation: null }
      : path === '/flows'
        ? [flow]
        : flow
    await route.fulfill({ json: { data } })
  })
  return state
}
