import type { Page } from '@playwright/test'

/** Isolated browser UI fixtures: no backend, sends, or persistent tenant data. */
export async function mockFrontend(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    let data: unknown = []
    if (path === '/auth/me')
      data = {
        user: {
          id: 'preview-user',
          name: 'Preview owner',
          email: 'preview@fenwira.test',
          emailVerified: true,
        },
        memberships: [
          {
            membershipId: 'preview-member',
            tenantId: 'preview-tenant',
            tenantName: 'Preview workspace',
            tenantSlug: 'preview',
            role: 'OWNER',
            permissions: [
              'automations.read',
              'automations.write',
              'automations.publish',
              'templates.read',
            ],
            require2fa: false,
          },
        ],
        csrfToken: 'preview-csrf',
        features: { managedLaunch: false },
        session: null,
      }
    await route.fulfill({ json: { data, meta: { unread: 0 } } })
  })
}
