# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-preview.spec.ts >> condition paths switch, and long conversations scroll inside a bounded phone
- Location: e2e/live-preview.spec.ts:76:5

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
      - paragraph [ref=e17]: When a message contains “hello”, send “Hello [name]!”, then if “[name]” is set, send “Yes branch message”; otherwise send “No branch message”.
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
        - generic [ref=e54]: Version 1 · 10/31/2026, 10:57:20 AM
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
                      - group "Edge from message to condition" [ref=e248] [cursor=pointer]
                    - img:
                      - group "Edge from condition to yes" [ref=e251] [cursor=pointer]
                    - img:
                      - group "Edge from condition to no" [ref=e254] [cursor=pointer]
                    - img:
                      - group "Edge from yes to end" [ref=e257] [cursor=pointer]
                    - img:
                      - group "Edge from no to end" [ref=e260] [cursor=pointer]
                  - generic:
                    - button "Add a step between Keyword and Message" [ref=e264]
                    - button "Add a step between Message and If value is set" [ref=e267]
                    - generic [ref=e269]:
                      - generic [ref=e270]: "Yes"
                      - button "Add a step between If value is set and Message" [ref=e271]
                    - generic [ref=e273]:
                      - generic [ref=e274]: "No"
                      - button "Add a step between If value is set and Message" [ref=e275]
                    - button "Add a step between Message and End" [ref=e278]
                    - button "Add a step between Message and End" [ref=e281]
                  - generic:
                    - group [ref=e283]:
                      - generic [ref=e284]:
                        - generic [ref=e285]:
                          - generic [ref=e289]: Start
                          - generic [ref=e290]: Ready
                        - generic [ref=e296]:
                          - paragraph [ref=e297]: Keyword
                          - paragraph [ref=e298]: When a message is “hello”
                    - group [ref=e300]:
                      - generic [ref=e301]:
                        - generic [ref=e303]:
                          - generic [ref=e306]: Message
                          - generic [ref=e307]: Ready
                        - generic [ref=e313]:
                          - paragraph [ref=e314]: Message
                          - paragraph [ref=e315]: "Hello {{contact.name}}!"
                        - generic [ref=e316]:
                          - generic [ref=e317]: Next
                          - generic [ref=e318]: If it fails
                    - group [ref=e321]:
                      - generic [ref=e322]:
                        - generic [ref=e324]:
                          - generic [ref=e329]: Condition
                          - generic [ref=e330]: Ready
                        - generic [ref=e336]:
                          - paragraph [ref=e337]: If value is set
                          - paragraph [ref=e338]: "{{contact.name}} is set"
                        - generic [ref=e339]:
                          - generic [ref=e340]: "Yes"
                          - generic [ref=e341]: "No"
                    - group [ref=e344]:
                      - generic [ref=e345]:
                        - generic [ref=e347]:
                          - generic [ref=e350]: Message
                          - generic [ref=e351]: Ready
                        - generic [ref=e357]:
                          - paragraph [ref=e358]: Message
                          - paragraph [ref=e359]: Yes branch message
                        - generic [ref=e360]:
                          - generic [ref=e361]: Next
                          - generic [ref=e362]: If it fails
                    - group [ref=e365]:
                      - generic [ref=e366]:
                        - generic [ref=e368]:
                          - generic [ref=e371]: Message
                          - generic [ref=e372]: Ready
                        - generic [ref=e378]:
                          - paragraph [ref=e379]: Message
                          - paragraph [ref=e380]: No branch message
                        - generic [ref=e381]:
                          - generic [ref=e382]: Next
                          - generic [ref=e383]: If it fails
                    - group [ref=e386]:
                      - generic [ref=e387]:
                        - generic [ref=e389]:
                          - generic [ref=e392]: Action
                          - generic [ref=e393]: Ready
                        - generic [ref=e399]:
                          - paragraph [ref=e400]: End
                          - paragraph [ref=e401]: Finish the automation
              - generic "Control Panel" [ref=e402]:
                - button "Zoom In" [ref=e403] [cursor=pointer]
                - button "Zoom Out" [ref=e406] [cursor=pointer]
                - button "Fit View" [ref=e409] [cursor=pointer]
              - img "Flow overview" [ref=e413]
        - region "Publish preparation" [ref=e421]:
          - button "Setup checklist · Ready to publish" [ref=e422]
      - complementary "Step settings and preview" [ref=e425]:
        - generic [ref=e426]:
          - generic [ref=e427]:
            - tablist "Canvas side panel" [ref=e428]:
              - tab "Node settings" [active] [selected] [ref=e429]
              - tab "Preview" [ref=e430]
            - button "Close side panel" [ref=e431]
          - tabpanel "Node settings" [ref=e435]:
            - region [ref=e436]:
              - generic [ref=e437]:
                - heading "Message" [level=2] [ref=e442]
                - button "Delete step Message" [ref=e443]: Delete
              - paragraph [ref=e447]: Send a WhatsApp message
              - generic [ref=e448]:
                - generic [ref=e449]:
                  - generic [ref=e450]: Message
                  - textbox "Message" [ref=e451]: "Hello {{contact.name}}!"
                  - paragraph [ref=e452]: Sent as a WhatsApp message. Outside the 24-hour window, use a template instead.
                - combobox "Insert a value into Message" [ref=e453]:
                  - generic: Insert value
              - region "Message preview" [ref=e456]:
                - heading "Preview" [level=3] [ref=e457]
                - generic [ref=e458]:
                  - region "Message preview" [ref=e459]:
                    - generic [ref=e461]: 9:41
                    - generic [ref=e470]:
                      - generic [aria-hidden] [ref=e473]: "Y"
                      - generic [ref=e474]:
                        - paragraph [ref=e475]: Your business
                        - paragraph [ref=e476]: Business account
                    - region "Preview conversation messages" [ref=e488]:
                      - generic [aria-hidden] [ref=e489]: Today
                      - figure "Message preview" [ref=e491]:
                        - generic [ref=e492]:
                          - paragraph [ref=e493]: "Hello {{contact.name}}!"
                          - generic [aria-hidden] [ref=e494]: 9:41 AM
                    - generic [ref=e496]: Message
                  - paragraph [ref=e512]: Recipient preview · layout varies by device.
                - paragraph [ref=e513]: Expression markers are replaced with actual contact or event values when this step runs.
  - region "Notifications alt+T"
  - alert [ref=e514]
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
  68  |     .fill('Updated for {{contact.firstName}} in {{contact.city}}')
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
> 93  |   await page.getByLabel('Message', { exact: true }).fill('Very long body. '.repeat(190))
      |                                                     ^ Error: locator.fill: Error: strict mode violation: getByLabel('Message', { exact: true }) resolved to 3 elements:
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
  169 |                 { type: 'QUICK_REPLY', text: 'Confirm' },
  170 |                 { type: 'QUICK_REPLY', text: 'Change' },
  171 |                 { type: 'QUICK_REPLY', text: 'Help' },
  172 |               ],
  173 |             },
  174 |             samples: { body: [] },
  175 |           },
  176 |         ],
  177 |       },
  178 |     }),
  179 |   )
  180 |   const calls: string[] = []
  181 |   page.on('request', (request) => {
  182 |     if (request.url().includes('/api/v1/')) calls.push(request.url())
  183 |   })
  184 |   await page.goto('/automations/canvas-fixture/edit')
  185 |   await page.getByRole('button', { name: 'Preview', exact: true }).click()
  186 |   const preview = page.getByRole('region', { name: 'Live mobile preview' })
  187 |   await expect(preview).toContainText('Hello Asha.')
  188 |   await expect(preview).toContainText('Image header sample')
  189 |   await expect(preview).toContainText('Order terms and conditions')
  190 |   await expect(
  191 |     preview.getByRole('list', { name: 'Template buttons' }).getByRole('listitem'),
  192 |   ).toHaveCount(3)
  193 |   expect(
```