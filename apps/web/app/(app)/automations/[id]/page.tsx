import { redirect } from 'next/navigation'

/** Preserve older saved editor links, including starter-template checklist context. */
export default async function AutomationRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      query.append(key, item)
  }
  redirect(`/automations/${id}/edit${query.size ? `?${query}` : ''}`)
}
