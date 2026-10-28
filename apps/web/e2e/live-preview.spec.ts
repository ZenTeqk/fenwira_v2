import AxeBuilder from '@axe-core/playwright'
import { type DraftGraph } from '@fenwira/contracts'
import { expect, test } from '@playwright/test'
import { canvasGraph, mockCanvas } from './canvas-fixture'

const branchGraph: DraftGraph = {
  nodes: [
    ...canvasGraph.nodes.filter((node) => node.id !== 'end'),
    { id: 'condition', type: 'condition.exists', config: { subject: '{{contact.name}}' } },
    { id: 'yes', type: 'action.send_message', config: { text: 'Yes branch message' } },
    { id: 'no', type: 'action.send_message', config: { text: 'No branch message' } },
    { id: 'end', type: 'action.end', config: {} },
  ],
  edges: [
    canvasGraph.edges[0]!,
    { id: 'ec', source: 'message', target: 'condition', sourceHandle: 'next' },
    { id: 'ey', source: 'condition', target: 'yes', sourceHandle: 'yes' },
    { id: 'en', source: 'condition', target: 'no', sourceHandle: 'no' },
    { id: 'ye', source: 'yes', target: 'end', sourceHandle: 'next' },
    { id: 'ne', source: 'no', target: 'end', sourceHandle: 'next' },
  ],
  layout: {},
}

for (const width of [1440, 390])
  test(`live preview, sample contact and axe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await mockCanvas(page)
    await page.goto('/automations/canvas-fixture/edit')
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('region', { name: 'Live mobile preview' })
    await expect(preview.getByText('Hello Asha Patel!', { exact: true })).toBeVisible()
    await preview.getByRole('button', { name: 'Sample contact', exact: true }).click()
    await page.getByLabel('Sample name', { exact: true }).fill('Mira Rao')
    await page.getByLabel('Sample properties', { exact: true }).fill('city=Pune')
    await page.keyboard.press('Escape')
    await expect(preview.getByText('Hello Mira Rao!', { exact: true })).toBeVisible()
    await preview.getByTestId('preview-step-message').getByRole('button').click()
    await expect(preview.getByTestId('preview-step-message')).toHaveAttribute(
      'data-selected',
      'true',
    )
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    // Opening the phone is remembered for this signed-in user and workspace.
    await page.reload()
    await expect(page.getByRole('region', { name: 'Live mobile preview' })).toBeVisible()
  })

test('editing a draft updates preview and canvas/message selection links both ways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockCanvas(page)
  await page.goto('/automations/canvas-fixture/edit')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await page.getByTestId('flow-node-message').click()
  const preview = page.getByRole('region', { name: 'Live mobile preview' })
  await expect(preview.getByTestId('preview-step-message')).toHaveAttribute('data-selected', 'true')
  await page.getByRole('tab', { name: 'Node settings', exact: true }).click()
  await page
    .getByLabel('Message', { exact: true })
    .fill('Updated for {{contact.firstName}} in {{contact.city}}')
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(preview).toContainText('Updated for Asha in')
  await expect(preview.getByLabel('Missing value: contact.city')).toBeVisible()
  await preview.getByTestId('preview-step-trigger').getByRole('button').click()
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', 'trigger')
})

test('condition paths switch, and long conversations scroll inside a bounded phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockCanvas(page, structuredClone(branchGraph))
  await page.goto('/automations/canvas-fixture/edit')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Live mobile preview' })
  const frame = preview.getByRole('region', { name: 'Message preview', exact: true })
  const height = (await frame.boundingBox())!.height
  await expect(preview).toContainText('Yes branch message')
  await preview.getByRole('button', { name: 'No', exact: true }).click()
  await expect(preview).toContainText('No branch message')
  await expect(preview).not.toContainText('Yes branch message')
  // Editing only text preserves the scroll position and frame geometry.
  await preview.getByTestId('preview-step-message').getByRole('button').click()
  await page.getByRole('tab', { name: 'Node settings', exact: true }).click()
  await page.getByLabel('Message', { exact: true }).fill('Very long body. '.repeat(190))
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(preview).toContainText('Very long body.')
  expect((await frame.boundingBox())!.height).toBe(height)
  const chat = preview.getByTestId('phone-chat')
  expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await chat.evaluate((el) => {
    el.scrollTop = 50
  })
  await page.getByRole('tab', { name: 'Node settings', exact: true }).click()
  await page.getByLabel('Message', { exact: true }).fill('Very long edited body. '.repeat(170))
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(preview).toContainText('Very long edited body.')
  expect(await chat.evaluate((el) => el.scrollTop)).toBe(50)
})

test('a long flow scrolls inside the bounded phone and stops after 30 steps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const graph = structuredClone(canvasGraph)
  graph.nodes = graph.nodes.filter((node) => node.id !== 'end')
  graph.edges = graph.edges.filter((edge) => edge.target !== 'end')
  for (let index = 0; index < 33; index++) {
    graph.nodes.push({
      id: `long-${index}`,
      type: 'action.send_message',
      config: { text: `Follow-up ${index}` },
    })
    graph.edges.push({
      id: `long-edge-${index}`,
      source: index === 0 ? 'message' : `long-${index - 1}`,
      target: `long-${index}`,
      sourceHandle: 'next',
    })
  }
  await mockCanvas(page, graph)
  await page.goto('/automations/canvas-fixture/edit')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Live mobile preview' })
  await expect(
    preview.getByRole('list', { name: 'Preview steps' }).getByRole('listitem'),
  ).toHaveCount(31)
  await expect(preview).toContainText('Preview truncated')
  const chat = preview.getByTestId('phone-chat')
  expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  const frame = preview.getByRole('region', { name: 'Message preview', exact: true })
  const bounds = (await frame.boundingBox())!
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000)
})

test('template preview reuses the complete inbox bubble without fetching media or running actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const graph = structuredClone(canvasGraph)
  graph.nodes[1] = {
    id: 'message',
    type: 'action.send_template',
    config: { templateId: 'template', variables: { body: ['{{contact.firstName}}'] } },
  }
  await mockCanvas(page, graph)
  await page.route('**/api/v1/templates/approved', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            templateId: 'template',
            versionId: 'version',
            name: 'Order update',
            language: 'en',
            category: 'UTILITY',
            components: {
              header: { format: 'IMAGE', sampleFileId: 'image-file' },
              body: { text: 'Hello {{1}}. ' + 'Detailed order information. '.repeat(45) },
              footer: { text: 'Order terms and conditions' },
              buttons: [
                { type: 'QUICK_REPLY', text: 'Confirm' },
                { type: 'QUICK_REPLY', text: 'Change' },
                { type: 'QUICK_REPLY', text: 'Help' },
              ],
            },
            samples: { body: [] },
          },
        ],
      },
    }),
  )
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) calls.push(request.url())
  })
  await page.goto('/automations/canvas-fixture/edit')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Live mobile preview' })
  await expect(preview).toContainText('Hello Asha.')
  await expect(preview).toContainText('Image header sample')
  await expect(preview).toContainText('Order terms and conditions')
  await expect(
    preview.getByRole('list', { name: 'Template buttons' }).getByRole('listitem'),
  ).toHaveCount(3)
  expect(
    await preview.getByTestId('phone-chat').evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true)
  expect(calls.filter((url) => /download-url|\/publish|\/test|\/send|\/ai\//.test(url))).toEqual([])
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])
})
