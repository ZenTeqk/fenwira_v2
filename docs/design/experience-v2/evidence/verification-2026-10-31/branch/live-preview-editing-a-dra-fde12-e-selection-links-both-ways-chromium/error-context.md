# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-preview.spec.ts >> editing a draft updates preview and canvas/message selection links both ways
- Location: e2e/live-preview.spec.ts:55:5

# Error details

```
Error: locator.fill: Error: strict mode violation: getByLabel('Message', { exact: true }) resolved to 3 elements:
    1) <button draggable="true" data-slot="button" aria-label="Message" class="inline-flex shrink-0 items-center whitespace-nowrap rounded-sm font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring border border-border-control bg-surface text-fg hover:bg-surface-hover text-sm h-auto min-h-11 justify-start gap-2 px-2 py-2 text-left">…</button> aka getByRole('button', { name: 'Message', exact: true })
    2) <section class="flex flex-col gap-4" aria-labelledby="inspector-title">…</section> aka getByRole('region', { name: 'Message', exact: true })
    3) <textarea rows="4" id="field-_r_14_" data-slot="textarea" aria-describedby="field-_r_14_-hint" class="w-full rounded-md border border-border-control bg-surface px-3 text-base text-fg placeholder:text-fg-muted transition-colors outline-none focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 aria-invalid:border-status-error aria-invalid:focus-visible:outline-status…>Hello {{contact.name}}!</textarea> aka getByRole('textbox', { name: 'Message' })

Call log:
  - waiting for getByLabel('Message', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main [ref=e3]:
    - generic [ref=e4]:
      - button "Back to Automations" [ref=e5]:
        - generic [ref=e8]: Automations
      - heading "Welcome flow" [level=1] [ref=e9]
      - textbox "Flow name" [ref=e10]: Welcome flow
      - generic [ref=e11]: Draft
      - button "Saved" [disabled]
      - paragraph [ref=e17]: When a message contains “hello”, send “Hello [name]!”.
      - generic [ref=e18]:
        - button "Preview" [pressed] [ref=e19]
        - button "Outline" [ref=e22]
        - button "Keyboard shortcuts" [ref=e23]
        - button "Settings" [ref=e27]
        - button "Did this run?" [ref=e31]
        - link "History" [ref=e32] [cursor=pointer]:
          - /url: /automations/canvas-fixture/history
        - button "Test flow" [ref=e37]
        - button "Publish" [ref=e40]
    - region "Draft and published versions" [ref=e46]:
      - generic [ref=e47]:
        - generic [ref=e48]: Draft changes
        - generic [ref=e54]: Version 1 · 10/31/2026, 10:57:18 AM
      - generic [ref=e55]: Not published yet
      - paragraph [ref=e57]: Running sessions keep their published version.
    - generic [ref=e58]:
      - complementary "Node library" [ref=e59]:
        - navigation "Add a step" [ref=e60]:
          - generic [ref=e61]:
            - heading "Add step" [level=2] [ref=e62]
            - textbox "Search steps" [ref=e63]:
              - /placeholder: Search steps…
          - generic [ref=e64]:
            - heading "Conditions" [level=3] [ref=e65]
            - button "Business hours" [ref=e66]:
              - generic [ref=e72]:
                - generic [ref=e73]: Business hours
                - generic "Check the workspace schedule and holidays" [ref=e74]
            - button "If contact has tag" [ref=e75]:
              - generic [ref=e80]:
                - generic [ref=e81]: If contact has tag
                - generic "Check the contact’s tags" [ref=e82]
            - button "If value equals" [ref=e83]:
              - generic [ref=e89]:
                - generic [ref=e90]: If value equals
                - generic "Compare two values" [ref=e91]
            - button "If value contains" [ref=e92]:
              - generic [ref=e98]:
                - generic [ref=e99]: If value contains
                - generic "Check part of a value" [ref=e100]
            - button "If value is set" [ref=e101]:
              - generic [ref=e107]:
                - generic [ref=e108]: If value is set
                - generic "Check whether a value is set" [ref=e109]
            - button "If contact field" [ref=e110]:
              - generic [ref=e115]:
                - generic [ref=e116]: If contact field
                - generic "Check a contact field" [ref=e117]
          - generic [ref=e118]:
            - heading "Actions" [level=3] [ref=e119]
            - button "Message" [ref=e120]:
              - generic [ref=e124]:
                - generic [ref=e125]: Message
                - generic "Send a WhatsApp message" [ref=e126]
            - button "Options" [ref=e127]:
              - generic [ref=e131]:
                - generic [ref=e132]: Options
                - generic "Offer buttons, a list or a link" [ref=e133]
            - button "Question" [ref=e134]:
              - generic [ref=e138]:
                - generic [ref=e139]: Question
                - generic "Ask and wait, then save the answer" [ref=e140]
            - button "Send template" [ref=e141]:
              - generic [ref=e146]:
                - generic [ref=e147]: Send template
                - generic "Send an approved template" [ref=e148]
            - button "Handover" [ref=e149]:
              - generic [ref=e153]:
                - generic [ref=e154]: Handover
                - generic "Pass the enquiry and a private note to your team" [ref=e155]
            - button "Add tag" [ref=e156]:
              - generic [ref=e161]:
                - generic [ref=e162]: Add tag
                - generic "Add tags to the contact" [ref=e163]
            - button "Remove tag" [ref=e164]:
              - generic [ref=e169]:
                - generic [ref=e170]: Remove tag
                - generic "Remove tags from the contact" [ref=e171]
            - button "Assign conversation" [ref=e172]:
              - generic [ref=e177]:
                - generic [ref=e178]: Assign conversation
                - generic "Assign the conversation to a teammate" [ref=e179]
            - button "Update contact" [ref=e180]:
              - generic [ref=e185]:
                - generic [ref=e186]: Update contact
                - generic "Update contact information" [ref=e187]
            - button "Call webhook" [ref=e188]:
              - generic [ref=e194]:
                - generic [ref=e195]: Call webhook
                - generic "Send data to your system" [ref=e196]
            - button "Wait" [ref=e197]:
              - generic [ref=e202]:
                - generic [ref=e203]: Wait
                - generic "Wait for a specified time" [ref=e204]
            - button "End" [ref=e205]:
              - generic [ref=e209]:
                - generic [ref=e210]: End
                - generic "Finish this automation" [ref=e211]
          - generic [ref=e212]:
            - heading "AI" [level=3] [ref=e213]
            - button "AI reply" [ref=e214]:
              - generic [ref=e219]:
                - generic [ref=e220]: AI reply
                - generic "Answer with the AI Assistant" [ref=e221]
          - paragraph [ref=e222]: This flow already has its trigger. Select it on the canvas or outline to edit it.
      - generic [ref=e223]:
        - generic [ref=e224]:
          - generic [ref=e225]:
            - tablist "Builder view" [ref=e226]:
              - tab "Canvas" [selected] [ref=e227]
              - tab "Outline" [ref=e228]
            - generic [ref=e229]:
              - button "Hide steps" [expanded] [ref=e230]
              - button "Step counts" [ref=e233]
              - button "Tidy up" [ref=e236]
          - tabpanel "Canvas" [ref=e242]:
            - application "Flow canvas" [ref=e245]:
              - generic [ref=e247]:
                - generic:
                  - generic:
                    - img:
                      - group "Edge from trigger to message"
                    - img:
                      - group "Edge from message to end" [ref=e248] [cursor=pointer]
                  - generic:
                    - button "Add a step between Keyword and Message" [ref=e252]
                    - button "Add a step between Message and End" [ref=e255]
                  - generic:
                    - group [ref=e257]:
                      - generic [ref=e258]:
                        - generic [ref=e259]:
                          - generic [ref=e263]: Start
                          - generic [ref=e264]: Ready
                        - generic [ref=e270]:
                          - paragraph [ref=e271]: Keyword
                          - paragraph [ref=e272]: When a message is “hello”
                    - group [ref=e274]:
                      - generic [ref=e275]:
                        - generic [ref=e277]:
                          - generic [ref=e280]: Message
                          - generic [ref=e281]: Ready
                        - generic [ref=e287]:
                          - paragraph [ref=e288]: Message
                          - paragraph [ref=e289]: "Hello {{contact.name}}!"
                        - generic [ref=e290]:
                          - generic [ref=e291]: Next
                          - generic [ref=e292]: If it fails
                    - group [ref=e295]:
                      - generic [ref=e296]:
                        - generic [ref=e298]:
                          - generic [ref=e301]: Action
                          - generic [ref=e302]: Ready
                        - generic [ref=e308]:
                          - paragraph [ref=e309]: End
                          - paragraph [ref=e310]: Finish the automation
              - generic "Control Panel" [ref=e311]:
                - button "Zoom In" [ref=e312] [cursor=pointer]
                - button "Zoom Out" [ref=e315] [cursor=pointer]
                - button "Fit View" [ref=e318] [cursor=pointer]
              - img "Flow overview" [ref=e322]
        - region "Publish preparation" [ref=e327]:
          - button "Setup checklist · Ready to publish" [ref=e328]
      - complementary "Step settings and preview" [ref=e331]:
        - generic [ref=e332]:
          - generic [ref=e333]:
            - tablist "Canvas side panel" [ref=e334]:
              - tab "Node settings" [active] [selected] [ref=e335]
              - tab "Preview" [ref=e336]
            - button "Close side panel" [ref=e337]
          - tabpanel "Node settings" [ref=e341]:
            - region [ref=e342]:
              - generic [ref=e343]:
                - heading "Message" [level=2] [ref=e348]
                - button "Delete step Message" [ref=e349]: Delete
              - paragraph [ref=e353]: Send a WhatsApp message
              - generic [ref=e354]:
                - generic [ref=e355]:
                  - generic [ref=e356]: Message
                  - textbox "Message" [ref=e357]: "Hello {{contact.name}}!"
                  - paragraph [ref=e358]: Sent as a WhatsApp message. Outside the 24-hour window, use a template instead.
                - combobox "Insert a value into Message" [ref=e359]:
                  - generic: Insert value
              - region "Message preview" [ref=e362]:
                - heading "Preview" [level=3] [ref=e363]
                - generic [ref=e364]:
                  - region "Message preview" [ref=e365]:
                    - generic [ref=e367]: 9:41
                    - generic [ref=e376]:
                      - generic [aria-hidden] [ref=e379]: "Y"
                      - generic [ref=e380]:
                        - paragraph [ref=e381]: Your business
                        - paragraph [ref=e382]: Business account
                    - region "Preview conversation messages" [ref=e394]:
                      - generic [aria-hidden] [ref=e395]: Today
                      - figure "Message preview" [ref=e397]:
                        - generic [ref=e398]:
                          - paragraph [ref=e399]: "Hello {{contact.name}}!"
                          - generic [aria-hidden] [ref=e400]: 9:41 AM
                    - generic [ref=e402]: Message
                  - paragraph [ref=e418]: Recipient preview · layout varies by device.
                - paragraph [ref=e419]: Expression markers are replaced with actual contact or event values when this step runs.
  - region "Notifications alt+T"
  - alert [ref=e420]
```

# Test source

```ts
  1   | import AxeBuilder from '@axe-core/playwright'
  2   | import { type DraftGraph } from '@fenwira/contracts'
  3   | import { expect, test } from '@playwright/test'
  4   | import { canvasGraph, mockCanvas } from './canvas-fixture'
  5   | 
  6   | const branchGraph: DraftGraph = {
  7   |   nodes: [
  8   |     ...canvasGraph.nodes.filter((node) => node.id !== 'end'),
  9   |     { id: 'condition', type: 'condition.exists', config: { subject: '{{contact.name}}' } },
  10  |     { id: 'yes', type: 'action.send_message', config: { text: 'Yes branch message' } },
  11  |     { id: 'no', type: 'action.send_message', config: { text: 'No branch message' } },
  12  |     { id: 'end', type: 'action.end', config: {} },
  13  |   ],
  14  |   edges: [
  15  |     canvasGraph.edges[0]!,
  16  |     { id: 'ec', source: 'message', target: 'condition', sourceHandle: 'next' },
  17  |     { id: 'ey', source: 'condition', target: 'yes', sourceHandle: 'yes' },
  18  |     { id: 'en', source: 'condition', target: 'no', sourceHandle: 'no' },
  19  |     { id: 'ye', source: 'yes', target: 'end', sourceHandle: 'next' },
  20  |     { id: 'ne', source: 'no', target: 'end', sourceHandle: 'next' },
  21  |   ],
  22  |   layout: {},
  23  | }
  24  | 
  25  | for (const width of [1440, 390])
  26  |   test(`live preview, sample contact and axe at ${width}px`, async ({ page }) => {
  27  |     await page.setViewportSize({ width, height: 1000 })
  28  |     await mockCanvas(page)
  29  |     await page.goto('/automations/canvas-fixture/edit')
  30  |     await page.getByRole('button', { name: 'Preview', exact: true }).click()
  31  |     const preview = page.getByRole('region', { name: 'Live mobile preview' })
  32  |     await expect(preview.getByText('Hello Asha Patel!', { exact: true })).toBeVisible()
  33  |     await preview.getByRole('button', { name: 'Sample contact', exact: true }).click()
  34  |     await page.getByLabel('Sample name', { exact: true }).fill('Mira Rao')
  35  |     await page.getByLabel('Sample properties', { exact: true }).fill('city=Pune')
  36  |     await page.keyboard.press('Escape')
  37  |     await expect(preview.getByText('Hello Mira Rao!', { exact: true })).toBeVisible()
  38  |     await preview.getByTestId('preview-step-message').getByRole('button').click()
  39  |     await expect(preview.getByTestId('preview-step-message')).toHaveAttribute(
  40  |       'data-selected',
  41  |       'true',
  42  |     )
  43  |     expect(
  44  |       (
  45  |         await new AxeBuilder({ page })
  46  |           .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
  47  |           .analyze()
  48  |       ).violations,
  49  |     ).toEqual([])
  50  |     // Opening the phone is remembered for this signed-in user and workspace.
  51  |     await page.reload()
  52  |     await expect(page.getByRole('region', { name: 'Live mobile preview' })).toBeVisible()
  53  |   })
  54  | 
  55  | test('editing a draft updates preview and canvas/message selection links both ways', async ({
  56  |   page,
  57  | }) => {
  58  |   await page.setViewportSize({ width: 1440, height: 1000 })
  59  |   await mockCanvas(page)
  60  |   await page.goto('/automations/canvas-fixture/edit')
  61  |   await page.getByRole('button', { name: 'Preview', exact: true }).click()
  62  |   await page.getByTestId('flow-node-message').click()
  63  |   const preview = page.getByRole('region', { name: 'Live mobile preview' })
  64  |   await expect(preview.getByTestId('preview-step-message')).toHaveAttribute('data-selected', 'true')
  65  |   await page.getByRole('tab', { name: 'Node settings', exact: true }).click()
  66  |   await page
  67  |     .getByLabel('Message', { exact: true })
> 68  |     .fill('Updated for {{contact.firstName}} in {{contact.city}}')
      |      ^ Error: locator.fill: Error: strict mode violation: getByLabel('Message', { exact: true }) resolved to 3 elements:
  69  |   await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  70  |   await expect(preview).toContainText('Updated for Asha in')
  71  |   await expect(preview.getByLabel('Missing value: contact.city')).toBeVisible()
  72  |   await preview.getByTestId('preview-step-trigger').getByRole('button').click()
  73  |   await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', 'trigger')
  74  | })
  75  | 
  76  | test('condition paths switch, and long conversations scroll inside a bounded phone', async ({
  77  |   page,
  78  | }) => {
  79  |   await page.setViewportSize({ width: 1440, height: 1000 })
  80  |   await mockCanvas(page, structuredClone(branchGraph))
  81  |   await page.goto('/automations/canvas-fixture/edit')
  82  |   await page.getByRole('button', { name: 'Preview', exact: true }).click()
  83  |   const preview = page.getByRole('region', { name: 'Live mobile preview' })
  84  |   const frame = preview.getByRole('region', { name: 'Message preview', exact: true })
  85  |   const height = (await frame.boundingBox())!.height
  86  |   await expect(preview).toContainText('Yes branch message')
  87  |   await preview.getByRole('button', { name: 'No', exact: true }).click()
  88  |   await expect(preview).toContainText('No branch message')
  89  |   await expect(preview).not.toContainText('Yes branch message')
  90  |   // Editing only text preserves the scroll position and frame geometry.
  91  |   await preview.getByTestId('preview-step-message').getByRole('button').click()
  92  |   await page.getByRole('tab', { name: 'Node settings', exact: true }).click()
  93  |   await page.getByLabel('Message', { exact: true }).fill('Very long body. '.repeat(190))
  94  |   await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  95  |   await expect(preview).toContainText('Very long body.')
  96  |   expect((await frame.boundingBox())!.height).toBe(height)
  97  |   const chat = preview.getByTestId('phone-chat')
  98  |   expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  99  |   await chat.evaluate((el) => {
  100 |     el.scrollTop = 50
  101 |   })
  102 |   await page.getByRole('tab', { name: 'Node settings', exact: true }).click()
  103 |   await page.getByLabel('Message', { exact: true }).fill('Very long edited body. '.repeat(170))
  104 |   await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  105 |   await expect(preview).toContainText('Very long edited body.')
  106 |   expect(await chat.evaluate((el) => el.scrollTop)).toBe(50)
  107 | })
  108 | 
  109 | test('a long flow scrolls inside the bounded phone and stops after 30 steps', async ({ page }) => {
  110 |   await page.setViewportSize({ width: 1440, height: 1000 })
  111 |   await page.emulateMedia({ reducedMotion: 'reduce' })
  112 |   const graph = structuredClone(canvasGraph)
  113 |   graph.nodes = graph.nodes.filter((node) => node.id !== 'end')
  114 |   graph.edges = graph.edges.filter((edge) => edge.target !== 'end')
  115 |   for (let index = 0; index < 33; index++) {
  116 |     graph.nodes.push({
  117 |       id: `long-${index}`,
  118 |       type: 'action.send_message',
  119 |       config: { text: `Follow-up ${index}` },
  120 |     })
  121 |     graph.edges.push({
  122 |       id: `long-edge-${index}`,
  123 |       source: index === 0 ? 'message' : `long-${index - 1}`,
  124 |       target: `long-${index}`,
  125 |       sourceHandle: 'next',
  126 |     })
  127 |   }
  128 |   await mockCanvas(page, graph)
  129 |   await page.goto('/automations/canvas-fixture/edit')
  130 |   await page.getByRole('button', { name: 'Preview', exact: true }).click()
  131 |   const preview = page.getByRole('region', { name: 'Live mobile preview' })
  132 |   await expect(
  133 |     preview.getByRole('list', { name: 'Preview steps' }).getByRole('listitem'),
  134 |   ).toHaveCount(31)
  135 |   await expect(preview).toContainText('Preview truncated')
  136 |   const chat = preview.getByTestId('phone-chat')
  137 |   expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  138 |   const frame = preview.getByRole('region', { name: 'Message preview', exact: true })
  139 |   const bounds = (await frame.boundingBox())!
  140 |   expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000)
  141 | })
  142 | 
  143 | test('template preview reuses the complete inbox bubble without fetching media or running actions', async ({
  144 |   page,
  145 | }) => {
  146 |   await page.setViewportSize({ width: 1440, height: 1000 })
  147 |   const graph = structuredClone(canvasGraph)
  148 |   graph.nodes[1] = {
  149 |     id: 'message',
  150 |     type: 'action.send_template',
  151 |     config: { templateId: 'template', variables: { body: ['{{contact.firstName}}'] } },
  152 |   }
  153 |   await mockCanvas(page, graph)
  154 |   await page.route('**/api/v1/templates/approved', (route) =>
  155 |     route.fulfill({
  156 |       json: {
  157 |         data: [
  158 |           {
  159 |             templateId: 'template',
  160 |             versionId: 'version',
  161 |             name: 'Order update',
  162 |             language: 'en',
  163 |             category: 'UTILITY',
  164 |             components: {
  165 |               header: { format: 'IMAGE', sampleFileId: 'image-file' },
  166 |               body: { text: 'Hello {{1}}. ' + 'Detailed order information. '.repeat(45) },
  167 |               footer: { text: 'Order terms and conditions' },
  168 |               buttons: [
```