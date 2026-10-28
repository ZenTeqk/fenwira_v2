import { expect, test } from '@playwright/test'
import { mockFrontend } from './frontend-fixture'

for (const width of [1440, 390]) {
  for (const zoom of [1, 2]) {
    test(`bounded template phone at ${width}px, ${zoom * 100}% zoom`, async ({ page }) => {
      // Browser zoom halves the CSS viewport at 200%; deviceScaleFactor alone does not zoom layout.
      await page.setViewportSize({ width: width / zoom, height: 1000 / zoom })
      await mockFrontend(page)
      await page.route('**/api/v1/templates/samples/sample-image/url', (route) =>
        route.fulfill({ json: { data: { url: '/brand/apple-icon.png' } } }),
      )
      let long = false
      await page.route('**/api/v1/templates/phone-fixture', (route) =>
        route.fulfill({
          json: {
            data: {
              id: 'phone-fixture',
              name: 'Long template preview',
              language: 'en',
              category: 'UTILITY',
              wabaName: 'Fenwira',
              status: 'APPROVED',
              currentVersion: {
                id: 'version',
                version: 1,
                status: 'APPROVED',
                components: {
                  header: { format: 'IMAGE', sampleFileId: 'sample-image' },
                  body: {
                    text: long
                      ? 'A detailed order update with all the information you need. '.repeat(50)
                      : 'Hello there.',
                  },
                  footer: { text: long ? 'Terms and delivery details. '.repeat(20) : 'Thank you' },
                  buttons: [
                    { type: 'QUICK_REPLY', text: 'Confirm' },
                    { type: 'QUICK_REPLY', text: 'Change' },
                    { type: 'QUICK_REPLY', text: 'Help' },
                  ],
                },
                samples: { body: [] },
              },
            },
          },
        }),
      )
      await page.goto('/templates/phone-fixture')
      const frame = page.getByRole('region', { name: 'Message preview', exact: true })
      await expect(frame).toBeVisible()
      const shortHeight = (await frame.boundingBox())!.height
      long = true
      await page.reload()
      await expect(frame).toBeVisible()
      expect((await frame.boundingBox())!.height).toBe(shortHeight)
      const chat = frame.getByTestId('phone-chat')
      expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      await chat.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      for (const part of ['phone-header', 'phone-input']) {
        const bounds = (await frame.getByTestId(part).boundingBox())!
        const outer = (await frame.boundingBox())!
        expect(bounds.y).toBeGreaterThanOrEqual(outer.y)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(outer.y + outer.height)
      }
    })
  }
}
