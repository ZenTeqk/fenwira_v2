# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: design-system.spec.ts >> contacts: quick view drawer explains what can be sent
- Location: e2e/design-system.spec.ts:94:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('dialog', { name: 'Farah Ali' }).getByRole('region', { name: 'Messaging eligibility' })
Expected substring: "Free-form replies"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('dialog', { name: 'Farah Ali' }).getByRole('region', { name: 'Messaging eligibility' }) with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Farah Ali' }).getByRole('region', { name: 'Messaging eligibility' })

```

```yaml
- link "Skip to content":
  - /url: "#main"
- complementary:
  - link "Fenwira Fenwira home":
    - /url: /dashboard
  - navigation "Main":
    - list:
      - listitem:
        - link "Home":
          - /url: /dashboard
      - listitem:
        - link "Inbox":
          - /url: /inbox
      - listitem:
        - link "Contacts":
          - /url: /contacts
      - listitem:
        - link "Campaigns":
          - /url: /campaigns
      - listitem:
        - link "Templates":
          - /url: /templates
      - listitem:
        - link "Automations":
          - /url: /automations/workflows
        - button "Expand Automations"
      - listitem:
        - link "AI Assistant":
          - /url: /ai-assistant
      - listitem:
        - link "Analytics":
          - /url: /analytics
      - listitem:
        - link "Integrations":
          - /url: /integrations
      - listitem:
        - link "Billing":
          - /url: /billing/subscription
      - listitem:
        - link "Settings":
          - /url: /settings/workspace
  - list "Workspace status":
    - listitem:
      - link "WhatsApp · Not connected":
        - /url: /integrations/whatsapp
  - button "ui-drawer Owner Owner Workspace account menu"
  - button "Collapse sidebar": Collapse
- banner:
  - 'button "Current workspace: ui-drawer Workspace. Switch workspace"': UW ui-drawer Workspace
  - button "Search and jump to (Control K)": Search Fenwira… ⌘K
  - button "Help"
  - button "Notifications"
  - button "Account menu"
- main:
  - heading "Contacts" [level=1]
  - paragraph: People your team communicates with on WhatsApp.
  - link "Import":
    - /url: /contacts/imports
  - button "Add contact"
  - navigation "Contacts pages":
    - list:
      - listitem:
        - link "All contacts":
          - /url: /contacts
      - listitem:
        - link "Segments":
          - /url: /contacts/segments
      - listitem:
        - link "Tags":
          - /url: /contacts/tags
      - listitem:
        - link "Imports":
          - /url: /contacts/imports
  - region "Contact directory":
    - group "Filters":
      - searchbox "Search contacts"
      - combobox "Filter by tag": All tags
      - combobox "Filter by assignment": Assignment
      - button "More filters"
      - button "Columns"
    - region "Contacts scroll area":
      - table "Contacts":
        - rowgroup:
          - row "Select all rows Contact Phone Tags WhatsApp Last incoming Assigned Actions":
            - columnheader "Select all rows":
              - checkbox "Select all rows"
            - columnheader "Contact"
            - columnheader "Phone"
            - columnheader "Tags"
            - columnheader "WhatsApp"
            - columnheader "Last incoming"
            - columnheader "Assigned"
            - columnheader "Actions"
        - rowgroup:
          - row "Select Farah Ali Farah Ali Farah Ali Added manually +91 98765 00011 — Template required Marketing restricted — Unassigned Actions for Farah Ali":
            - cell "Select Farah Ali":
              - checkbox "Select Farah Ali"
            - cell "Farah Ali Farah Ali Added manually":
              - text: FA
              - button "Farah Ali"
              - paragraph: Added manually
            - cell "+91 98765 00011"
            - cell "—"
            - cell "Template required Marketing restricted"
            - cell "—"
            - cell "Unassigned"
            - cell "Actions for Farah Ali":
              - button "Actions for Farah Ali"
    - navigation "Pagination":
      - paragraph:
        - status: 1 contacts · Page 1
      - button "Previous" [disabled]
      - button "Next" [disabled]
  - complementary "Farah Ali":
    - text: FA
    - heading "Farah Ali" [level=2]
    - paragraph: +91 98765 00011
    - paragraph: Added manually
    - button "Close contact details"
    - button "More"
    - region "Contact information":
      - heading "Contact" [level=3]
      - term: Phone
      - definition: +91 98765 00011
      - term: Country
      - definition: IN
    - region "Contact tags":
      - heading "Tags" [level=3]
      - text: —
    - region "WhatsApp relationship":
      - heading "WhatsApp eligibility" [level=3]
      - text: Service replies Can't send
      - paragraph: The 24-hour window is closed. Send an approved template to restart the conversation.
      - text: Marketing Can't send
      - paragraph: This contact has not opted in to marketing messages.
      - group: Eligibility and consent details
    - region "Contact assignment":
      - heading "Assigned to" [level=3]
      - text: Unassigned
    - region "Recent conversations":
      - heading "Recent conversations" [level=3]
      - paragraph: No conversations yet.
    - region "Recent activity":
      - heading "Recent activity" [level=3]
      - list "Recent contact activity":
        - listitem:
          - paragraph: Contact created
          - time: now
          - text: ui-drawer Owner
    - group: Campaign history
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  5   | /** Design System v1 interactions (docs/design/UX_PATTERNS.md). */
  6   | test.beforeEach(() => resetRateLimits())
  7   | 
  8   | const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  9   | async function expectNoViolations(page: Page, include?: string) {
  10  |   const b = new AxeBuilder({ page }).withTags(TAGS)
  11  |   if (include) b.include(include)
  12  |   const r = await b.analyze()
  13  |   expect(
  14  |     r.violations.map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target) })),
  15  |   ).toEqual([])
  16  | }
  17  | 
  18  | test('shell: modules in the sidebar, sub-pages as module tabs, status footer and help', async ({
  19  |   page,
  20  | }) => {
  21  |   const owner = await signInAsNewOwner(page, 'ui-shell', 'Shell Traders')
  22  |   await page.goto('/dashboard')
  23  |   const main = page.getByRole('navigation', { name: 'Main' })
  24  |   await expect(main.getByRole('link', { name: 'Contacts' })).toBeVisible()
  25  |   await expect(main.getByRole('link', { name: 'Segments' })).toHaveCount(0)
  26  |   // The top bar carries the workspace.
  27  |   await expect(
  28  |     page.getByRole('banner').getByRole('button', { name: /Current workspace: Shell Traders/ }),
  29  |   ).toBeVisible()
  30  | 
  31  |   await main.getByRole('link', { name: 'Contacts' }).click()
  32  |   const tabs = page.getByRole('navigation', { name: 'Contacts pages' })
  33  |   await expect(tabs.getByRole('link', { name: 'All contacts' })).toHaveAttribute(
  34  |     'aria-current',
  35  |     'page',
  36  |   )
  37  |   await tabs.getByRole('link', { name: 'Segments' }).click()
  38  |   await expect(page.getByRole('heading', { level: 1, name: 'Segments' })).toBeVisible()
  39  |   await expect(main.getByRole('link', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page')
  40  | 
  41  |   // Workspace status: WhatsApp appears once a number is connected.
  42  |   const status = page.getByRole('list', { name: 'Workspace status' })
  43  |   await expect(status).toContainText('WhatsApp · Not connected')
  44  |   await customerWritesIn(page, owner, 'Hello')
  45  |   await page.reload()
  46  |   await expect(status).toContainText('WhatsApp · Connected')
  47  | 
  48  |   await page.getByRole('button', { name: 'Help' }).click()
  49  |   await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  50  |   await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
  51  |     '⌘K / Ctrl K',
  52  |   )
  53  | })
  54  | 
  55  | test('Home: needs attention, real activity and secondary metrics', async ({ page }) => {
  56  |   const owner = await signInAsNewOwner(page, 'ui-dash')
  57  |   await page.goto('/dashboard')
  58  |   const attention = page.getByRole('region', { name: 'Needs attention' })
  59  |   await expect(attention.getByText('Connect a WhatsApp number')).toBeVisible()
  60  |   await expect(page.locator('[data-slot="metric-card"]')).toHaveCount(4)
  61  |   await expectNoViolations(page)
  62  | 
  63  |   await customerWritesIn(page, owner, 'Is anyone there?')
  64  |   await page.reload()
  65  |   await expect(attention.getByText(/conversation waiting for an owner/)).toBeVisible()
  66  |   await expect(attention.getByText('Connect a WhatsApp number')).toHaveCount(0)
  67  |   await attention.getByRole('link', { name: 'Open inbox' }).click()
  68  |   await expect(page).toHaveURL(/\/inbox$/)
  69  | })
  70  | 
  71  | test('command palette finds records and starts create actions', async ({ page }) => {
  72  |   const owner = await signInAsNewOwner(page, 'ui-cmd')
  73  |   const res = await page.request.post(`${API}/contacts`, {
  74  |     data: { name: 'Zainab Qureshi', phone: '+919876512345' },
  75  |     headers: ownerHeaders(owner),
  76  |   })
  77  |   expect(res.status()).toBe(201)
  78  |   await page.goto('/dashboard')
  79  |   await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  80  |   await page.keyboard.press('Control+k')
  81  |   await page.keyboard.type('zainab')
  82  |   const option = page.getByRole('option', { name: /Zainab Qureshi/ })
  83  |   await expect(option).toBeVisible({ timeout: 15_000 })
  84  |   await expectNoViolations(page, '[data-slot="command-palette"]')
  85  |   await option.click()
  86  |   await expect(page.getByRole('heading', { level: 1, name: 'Zainab Qureshi' })).toBeVisible()
  87  | 
  88  |   await page.keyboard.press('Control+k')
  89  |   await page.keyboard.type('new contact')
  90  |   await page.getByRole('option', { name: 'New contact' }).click()
  91  |   await expect(page.getByRole('dialog', { name: /New contact/ })).toBeVisible()
  92  | })
  93  | 
  94  | test('contacts: quick view drawer explains what can be sent', async ({ page }) => {
  95  |   const owner = await signInAsNewOwner(page, 'ui-drawer')
  96  |   await page.request.post(`${API}/contacts`, {
  97  |     data: { name: 'Farah Ali', phone: '+919876500011' },
  98  |     headers: ownerHeaders(owner),
  99  |   })
  100 |   await page.goto('/contacts')
  101 |   await page.getByRole('button', { name: 'Actions for Farah Ali' }).click()
  102 |   await page.getByRole('menuitem', { name: 'Quick view' }).click()
  103 |   const drawer = page.getByRole('dialog', { name: 'Farah Ali' })
  104 |   const eligibility = drawer.getByRole('region', { name: 'Messaging eligibility' })
> 105 |   await expect(eligibility).toContainText('Free-form replies')
      |                             ^ Error: expect(locator).toContainText(expected) failed
  106 |   await expect(eligibility).toContainText("Can't send")
  107 |   await expect(eligibility).toContainText('This contact has not opted in to marketing messages.')
  108 |   await expectNoViolations(page, '[data-slot="drawer"]')
  109 |   await drawer.getByRole('link', { name: 'Open full profile' }).click()
  110 |   await expect(page.getByRole('heading', { level: 1, name: 'Farah Ali' })).toBeVisible()
  111 |   await expect(page.getByRole('region', { name: 'Messaging eligibility' })).toBeVisible()
  112 | })
  113 | 
  114 | test('automations: a starter recipe opens as a ready draft in the builder', async ({ page }) => {
  115 |   await signInAsNewOwner(page, 'ui-recipe')
  116 |   await page.goto('/automations/new')
  117 |   await expectNoViolations(page)
  118 |   await page.getByTestId('template-keyword-reply').click()
  119 |   await expect(page.getByRole('heading', { level: 1, name: 'Keyword reply' })).toBeVisible()
  120 |   await expect(page).toHaveURL(/\/automations\/[^/]+\/edit/)
  121 |   await expect(page.getByTestId(/^flow-node-/)).toHaveCount(3)
  122 |   await expect(page.getByRole('button', { name: /Setup checklist/ })).toBeVisible()
  123 | })
  124 | 
```