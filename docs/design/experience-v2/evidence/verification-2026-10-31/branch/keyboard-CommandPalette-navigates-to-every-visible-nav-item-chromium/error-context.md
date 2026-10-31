# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: keyboard.spec.ts >> CommandPalette navigates to every visible nav item
- Location: e2e/keyboard.spec.ts:77:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('navigation', { name: 'Breadcrumb' }).first()
Expected substring: "All contacts"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('navigation', { name: 'Breadcrumb' }).first() with timeout 5000ms
  - waiting for getByRole('navigation', { name: 'Breadcrumb' }).first()

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
  - button "ui-palette-nav Owner Owner Workspace account menu"
  - button "Collapse sidebar": Collapse
- banner:
  - 'button "Current workspace: ui-palette-nav Workspace. Switch workspace"': UW ui-palette-nav Workspace
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
    - paragraph: No contacts yet
    - paragraph: Contacts are the people you message on WhatsApp. They appear when customers write to you; you can also add them or import a CSV, with their consent.
    - button "Add your first contact"
    - link "Import CSV":
      - /url: /contacts/imports
    - navigation "Pagination":
      - paragraph:
        - status: 0 contacts · Page 1
      - button "Previous" [disabled]
      - button "Next" [disabled]
- region "Notifications alt+T"
- alert: Fenwira
```

# Test source

```ts
  16  |   await expect(page.getByRole('menuitem', { name: 'Message' })).toBeFocused()
  17  |   await page.keyboard.press('Enter')
  18  |   await expect(page.getByRole('menu')).toBeHidden()
  19  |   await expect(page.getByTestId('last-action')).toHaveText('Message')
  20  |   await expect(trigger).toBeFocused()
  21  | })
  22  | 
  23  | test('Modal: focus moves in, Tab stays trapped, Escape closes and restores focus', async ({
  24  |   page,
  25  | }) => {
  26  |   await page.goto('/dev/ui')
  27  |   const opener = page.getByRole('button', { name: 'Open modal' })
  28  |   await opener.focus()
  29  |   await page.keyboard.press('Enter')
  30  |   const dialog = page.getByRole('dialog', { name: 'Edit contact' })
  31  |   await expect(dialog).toBeVisible()
  32  |   for (let i = 0; i < 6; i++) {
  33  |     await page.keyboard.press('Tab')
  34  |     expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  35  |   }
  36  |   await page.keyboard.press('Escape')
  37  |   await expect(dialog).toBeHidden()
  38  |   await expect(opener).toBeFocused()
  39  | })
  40  | 
  41  | test('Tabs: arrow keys move between tabs and panels', async ({ page }) => {
  42  |   await page.goto('/dev/ui')
  43  |   const list = page.getByRole('tablist', { name: 'Contact sections' })
  44  |   await list.getByRole('tab', { name: 'Overview' }).focus()
  45  |   await page.keyboard.press('ArrowRight')
  46  |   await expect(list.getByRole('tab', { name: 'Conversations' })).toBeFocused()
  47  |   await expect(list.getByRole('tab', { name: 'Conversations' })).toHaveAttribute(
  48  |     'aria-selected',
  49  |     'true',
  50  |   )
  51  |   await page.keyboard.press('End')
  52  |   await expect(list.getByRole('tab', { name: 'Consent' })).toHaveAttribute('aria-selected', 'true')
  53  | })
  54  | 
  55  | test('ConfirmDialog: focus starts on Cancel, Escape cancels', async ({ page }) => {
  56  |   await page.goto('/dev/ui')
  57  |   await page.getByRole('button', { name: 'Delete tag…' }).click()
  58  |   const dialog = page.getByRole('alertdialog', { name: 'Delete this tag?' })
  59  |   await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  60  |   await page.keyboard.press('Escape')
  61  |   await expect(page.getByTestId('last-action')).toHaveText('Delete cancelled')
  62  | })
  63  | 
  64  | test('CommandPalette: Control+K opens, type to filter, Enter runs', async ({ page }) => {
  65  |   await signInAsNewOwner(page, 'ui-palette')
  66  |   await page.goto('/dashboard')
  67  |   await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  68  |   await page.keyboard.press('Control+k')
  69  |   const input = page.getByPlaceholder(
  70  |     'Search contacts, conversations, campaigns… or jump to a page',
  71  |   )
  72  |   await expect(input).toBeFocused()
  73  |   await page.keyboard.press('Escape')
  74  |   await expect(input).toBeHidden()
  75  | })
  76  | 
  77  | test('CommandPalette navigates to every visible nav item', async ({ page }) => {
  78  |   test.setTimeout(90_000)
  79  |   await signInAsNewOwner(page, 'ui-palette-nav')
  80  |   await page.goto('/dashboard')
  81  |   await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  82  |   const hrefs = await page
  83  |     .getByRole('navigation', { name: 'Main' })
  84  |     .locator('a[href]')
  85  |     .evaluateAll((links) =>
  86  |       links.map((a) => ({ href: a.getAttribute('href')!, name: (a.textContent ?? '').trim() })),
  87  |     )
  88  |   expect(hrefs.length).toBeGreaterThan(0)
  89  | 
  90  |   // The sidebar lists modules; every page (sub-pages included) is in the palette's Go to group.
  91  |   await page.keyboard.press('Control+k')
  92  |   const navLabels = await page
  93  |     .getByRole('group', { name: 'Go to' })
  94  |     .getByRole('option')
  95  |     .allTextContents()
  96  |   await page.keyboard.press('Escape')
  97  |   expect(navLabels.length).toBeGreaterThanOrEqual(hrefs.length)
  98  | 
  99  |   for (const label of navLabels) {
  100 |     await page.keyboard.press('Control+k')
  101 |     await page
  102 |       .getByPlaceholder('Search contacts, conversations, campaigns… or jump to a page')
  103 |       .fill(label.replace(' › ', ' '))
  104 |     await page.getByRole('option', { name: label, exact: true }).click()
  105 |     await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  106 |     const leaf = label.split(' › ').pop()!
  107 |     if (leaf === 'Home') {
  108 |       await expect(page).toHaveURL(/\/dashboard$/)
  109 |       await expect(page.getByRole('heading', { level: 1, name: /Welcome back,/ })).toBeVisible()
  110 |     } else if (label === 'Inbox') {
  111 |       await expect(page).toHaveURL(/\/inbox$/)
  112 |       await expect(
  113 |         page.getByRole('heading', { level: 1, name: 'Inbox', exact: true }),
  114 |       ).toBeAttached()
  115 |     } else {
> 116 |       await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).first()).toContainText(leaf)
      |                                                                                  ^ Error: expect(locator).toContainText(expected) failed
  117 |     }
  118 |   }
  119 | })
  120 | 
```