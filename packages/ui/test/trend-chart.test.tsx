import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TrendChart } from '../src'

const data = [
  { label: '27 Sep', values: { sent: 10, failed: 1 } },
  { label: '28 Sep', values: { sent: 4, failed: 0 } },
]
const series = [
  { key: 'sent', label: 'Sent', tone: 'primary' as const },
  { key: 'failed', label: 'Failed', tone: 'danger' as const },
]

describe('TrendChart', () => {
  it('names the chart with its totals and labels every series in text', () => {
    render(<TrendChart label="Messages per day" data={data} series={series} />)
    expect(
      screen.getByRole('img', { name: 'Messages per day. Sent: 14 in total, Failed: 1 in total.' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('SentFailed')
  })

  it('offers the same numbers as a table', async () => {
    render(<TrendChart label="Messages per day" data={data} series={series} variant="bar" />)
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table', { name: 'Messages per day' })
    expect(table).toHaveTextContent('27 Sep101')
    expect(screen.getByRole('button', { name: 'Show as chart' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('lets keyboard users focus the scrolling table region', async () => {
    render(<TrendChart label="Messages per day" data={data} series={series} variant="bar" />)
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const region = screen.getByRole('region', { name: 'Messages per day table' })
    expect(region).toHaveAttribute('tabindex', '0')
    await userEvent.tab()
    expect(region).toHaveFocus()
  })

  it('renders zero activity without dividing by zero', () => {
    render(
      <TrendChart
        label="Runs"
        variant="stacked"
        data={[{ label: '28 Sep', values: {} }]}
        series={series}
      />,
    )
    expect(screen.getByRole('img', { name: /Sent: 0 in total/ })).toBeInTheDocument()
  })
})

describe('MetricCard', () => {
  it('shows the hint together with the change, so a rate keeps its explanation', async () => {
    const { MetricCard } = await import('../src')
    render(
      <MetricCard
        label="Delivery rate"
        value="—"
        delta={{ value: '+2.0 pts', direction: 'up', label: 'vs previous period' }}
        hint="No sent messages delivered in this period"
      />,
    )
    expect(screen.getByText('+2.0 pts')).toBeInTheDocument()
    expect(screen.getByText('No sent messages delivered in this period')).toBeInTheDocument()
  })
})
