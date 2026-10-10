import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Button,
  ConfirmProvider,
  ConnectionState,
  type ColumnDef,
  DataTable,
  FilterBar,
  ListPage,
  MetricCard,
  ModuleTabs,
  PermissionState,
  RowActions,
  SearchInput,
  SectionHeader,
  SummaryItem,
  DetailPage,
  Timeline,
  useConfirm,
} from '../src'

describe('SearchInput', () => {
  function Harness() {
    const [v, setV] = useState('')
    return <SearchInput label="Search contacts" value={v} onValueChange={setV} />
  }
  it('is labelled, clears with the button and with Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const box = screen.getByRole('searchbox', { name: 'Search contacts' })
    await user.type(box, 'asha')
    expect(box).toHaveValue('asha')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    await user.type(box, 'ravi{Escape}')
    expect(box).toHaveValue('')
  })
})

describe('FilterBar', () => {
  it('offers Clear filters only when something is active', async () => {
    const onClear = vi.fn()
    const { rerender } = render(
      <FilterBar activeCount={0} onClear={onClear}>
        <span>filters</span>
      </FilterBar>,
    )
    expect(screen.queryByRole('button', { name: /Clear filters/ })).toBeNull()
    rerender(
      <FilterBar activeCount={2} onClear={onClear}>
        <span>filters</span>
      </FilterBar>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters (2 active)' }))
    expect(onClear).toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument()
  })
})

describe('ConfirmDialog impact', () => {
  function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
    const confirm = useConfirm()
    return (
      <Button
        onClick={async () =>
          onResult(
            await confirm({
              title: 'Launch this campaign now?',
              impact: ['1,200 contacts receive it.', 'Estimated cost ₹156.'],
              confirmLabel: 'Launch campaign',
            }),
          )
        }
      >
        Open
      </Button>
    )
  }
  it('lists the expected impact before the action', async () => {
    const onResult = vi.fn()
    render(
      <ConfirmProvider>
        <Harness onResult={onResult} />
      </ConfirmProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const impact = screen.getByRole('list', { name: 'What will happen' })
    expect(impact).toHaveTextContent('1,200 contacts receive it.')
    expect(impact).toHaveTextContent('Estimated cost ₹156.')
    await userEvent.click(screen.getByRole('button', { name: 'Launch campaign' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  })
})

type Row = { id: string; name: string; phone: string }
const rows: Row[] = [
  { id: 'a', name: 'Asha', phone: '+91 1' },
  { id: 'b', name: 'Ravi', phone: '+91 2' },
]
const columns: Array<ColumnDef<Row>> = [
  { accessorKey: 'name', header: 'Name', meta: { label: 'Name' } },
  { accessorKey: 'phone', header: 'Phone', meta: { label: 'Phone', align: 'right' } },
  {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableHiding: false,
    cell: ({ row }) => (
      <RowActions
        label={`Actions for ${row.original.name}`}
        actions={[{ label: 'Quick view', onSelect: () => undefined }]}
      />
    ),
  },
]

describe('DataTable v1', () => {
  it('shows a bulk-action bar for the selection and can clear it', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        label="People"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        selectable
        bulkActions={(ids) => <Button size="sm">Tag {ids.length}</Button>}
      />,
    )
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'Select row a' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select row b' }))
    const bar = screen.getByRole('region', { name: 'Bulk actions' })
    expect(bar).toHaveTextContent('2 selected')
    expect(screen.getByRole('button', { name: 'Tag 2' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
  })

  it('hides columns from the Columns menu and right-aligns numeric cells', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        label="People"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        columnVisibility
      />,
    )
    expect(screen.getByRole('cell', { name: '+91 1' }).className).toContain('text-right')
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Phone' }))
    // The menu stays open for several toggles; close it to read the table again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('columnheader', { name: 'Phone' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
  })

  it('shows the error state instead of an empty state when loading fails', () => {
    render(
      <DataTable
        label="People"
        columns={columns}
        data={[]}
        getRowId={(r) => r.id}
        error={{ message: 'We could not load contacts.' }}
        empty={{ title: 'No contacts yet' }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load contacts.')
    expect(screen.queryByText('No contacts yet')).toBeNull()
  })

  it('names each row-action menu', () => {
    render(<DataTable label="People" columns={columns} data={rows} getRowId={(r) => r.id} />)
    expect(screen.getByRole('button', { name: 'Actions for Asha' })).toBeInTheDocument()
  })
})

describe('Shell and state components', () => {
  it('ModuleTabs marks the current page', () => {
    render(
      <ModuleTabs
        label="Contacts pages"
        items={[
          { id: 'all', label: 'All contacts', href: '/contacts', active: true },
          { id: 'seg', label: 'Segments', href: '/contacts/segments', active: false },
        ]}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Contacts pages' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All contacts' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Segments' })).not.toHaveAttribute('aria-current')
  })

  it('ConnectionState and Timeline never rely on color alone', () => {
    render(
      <>
        <ConnectionState status="DISCONNECTED" name="+91 98123" />
        <ConnectionState status="CONNECTED" variant="compact" name="WhatsApp" />
        <Timeline
          label="Steps"
          items={[{ id: '1', title: 'Send template', status: 'FAILED', description: 'No credit' }]}
        />
      </>,
    )
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp · Connected/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Steps' })).toHaveTextContent('Failed')
  })

  it('PermissionState names the missing permission', () => {
    render(<PermissionState what="billing" permission="billing.read" />)
    expect(screen.getByText("You don't have access")).toBeInTheDocument()
    expect(screen.getByText('billing.read')).toBeInTheDocument()
  })

  it('page patterns render one h1 and ordered section headings', () => {
    render(
      <ListPage header={{ title: 'Contacts', description: 'Everyone you message.' }}>
        <SectionHeader title="Recent" />
      </ListPage>,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2, name: 'Recent' })).toBeInTheDocument()
  })

  it('DetailPage renders the summary strip as a description list', () => {
    render(
      <DetailPage
        header={{ title: 'Asha Rao' }}
        summary={<SummaryItem label="Source">WhatsApp</SummaryItem>}
      >
        <MetricCard label="Open conversations" value="3" />
      </DetailPage>,
    )
    expect(screen.getByText('Source').tagName).toBe('DT')
    expect(screen.getByText('Open conversations')).toBeInTheDocument()
  })
})
