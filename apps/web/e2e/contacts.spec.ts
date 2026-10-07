import { expect, type Page, test } from '@playwright/test'
import { API, type Owner, resetRateLimits, signInAsNewOwner } from './support'

test.beforeEach(() => resetRateLimits())

const api = (page: Page, owner: Owner, path: string, data?: unknown) =>
  page.request.post(`${API}${path}`, {
    data,
    headers: { 'X-CSRF-Token': owner.csrf, 'X-Tenant-Id': owner.tenantId },
  })

test('create a contact, record consent with a note, and add a note', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-contacts')
  await page.goto('/contacts')
  await expect(page.getByText('No contacts yet')).toBeVisible()
  await page.getByRole('button', { name: 'Add contact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New contact' })
  await dialog.getByLabel('Phone').fill('98111 22233')
  await dialog.getByLabel('Name').fill('Kavya Iyer')
  await dialog.getByRole('button', { name: 'Create contact' }).click()

  await expect(page.getByRole('heading', { name: 'Kavya Iyer' })).toBeVisible()
  await expect(page.getByText('+919811122233')).toBeVisible()
  await page.getByRole('tab', { name: 'Consent' }).click()
  await expect(page.getByText('No consent recorded')).toBeVisible()
  await page.getByRole('button', { name: 'Change consent' }).click()
  const consent = page.getByRole('dialog', { name: 'Change consent' })
  await consent.getByLabel('Note').fill('Agreed at the counter on Sunday')
  await consent.getByRole('button', { name: 'Record opt-in' }).click()
  const history = page.getByRole('table', { name: 'Consent history' })
  await expect(history.getByText('Opted in')).toBeVisible()
  await expect(history.getByText('“Agreed at the counter on Sunday”')).toBeVisible()

  await page.getByRole('tab', { name: 'Notes' }).click()
  await page.getByLabel('Add a note').fill('Prefers evening calls')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Prefers evening calls')).toBeVisible()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByText('Opted in to marketing (Changed manually)')).toBeVisible()
})

test('filter the contact list and save the filter as a segment', async ({ page }) => {
  const owner = await signInAsNewOwner(page, 'ui-filter')
  for (const [phone, name] of [
    ['9822200001', 'Ravi Kumar'],
    ['9822200002', 'Meena Shah'],
    ['9822200003', 'Ravi Teja'],
  ])
    expect((await api(page, owner, '/contacts', { phone, name })).status()).toBe(201)
  await page.goto('/contacts')
  await expect(page.getByText('3 contacts · Page 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'More filters', exact: true }).click()
  await page.getByRole('button', { name: 'Add condition' }).click()
  await page.getByLabel('Value for Name').fill('ravi')
  await expect(page.getByText('2 contacts match')).toBeVisible()
  const table = page.getByRole('table', { name: 'Contacts' })
  await expect(table.getByText('Meena Shah')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save as segment' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save as segment' })
  await dialog.getByLabel('Segment name').fill('Ravis')
  await dialog.getByRole('button', { name: 'Save segment' }).click()
  await page.goto('/contacts/segments')
  await expect(page.getByRole('table', { name: 'Segments' }).getByText('Ravis')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Segments' }).getByText('≈ 2')).toBeVisible()
})

test('import a CSV through the wizard and see the rows with problems', async ({ page }) => {
  await signInAsNewOwner(page, 'ui-import')
  await page.goto('/contacts/imports')
  await page.getByRole('button', { name: 'Import contacts' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import contacts' })
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Phone,Name,Tags\n9833300001,Arjun,vip\n12345,Broken,\n9833300002,Divya,vip;new\n',
    ),
  })
  await expect(dialog.getByRole('table', { name: 'Column mapping' })).toBeVisible({
    timeout: 20_000,
  })
  await dialog.getByRole('button', { name: 'Check rows' }).click()
  await expect(dialog.getByText('2 of 3 rows are ready')).toBeVisible({ timeout: 20_000 })
  await expect(
    dialog.getByRole('table', { name: 'Preview of the first rows' }).getByText('Not a valid'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Import 2 contacts' }).click()
  await expect(dialog.getByText('2 created, 0 updated, 0 skipped, 1 with problems.')).toBeVisible({
    timeout: 20_000,
  })
  await expect(dialog.getByRole('button', { name: 'Download rows with problems' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/contacts/tags')
  await expect(page.getByRole('table', { name: 'Tags' }).getByText('vip')).toBeVisible()
})
