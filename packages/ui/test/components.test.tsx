import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  type ColumnDef,
  CommandPalette,
  ConfirmProvider,
  DataTable,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  DrawerContent,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KpiCard,
  Modal,
  ModalContent,
  ModalTrigger,
  PageHeader,
  Pagination,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  STATUS_PRESETS,
  StatusBadge,
  type StatusKey,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toaster,
  Tooltip,
  TooltipProvider,
  initials,
  useConfirm,
} from '../src'

describe('Button', () => {
  it('renders variants with the AA-safe strong fills', () => {
    render(
      <>
        <Button>Save</Button>
        <Button variant="danger">Delete</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('bg-primary-strong')
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-danger-strong')
  })

  it('is busy and disabled while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders its child with button styling when asChild', () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Go' }).className).toContain('bg-primary-strong')
  })
})

describe('form controls', () => {
  it('Field wires label, hint and error to the control', () => {
    render(
      <Field label="Email" hint="We never share it." error="Enter a valid email." required>
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText(/Email/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')!.split(' ')
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'We never share it.',
      'Enter a valid email.',
    ])
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email.')
  })

  it('Textarea, Checkbox, Radio and Switch are operable', async () => {
    render(
      <>
        <Field label="Notes">
          <Textarea />
        </Field>
        <Checkbox aria-label="Agree" />
        <RadioGroup aria-label="Plan" defaultValue="a">
          <RadioGroupItem value="a" aria-label="Plan A" />
          <RadioGroupItem value="b" aria-label="Plan B" />
        </RadioGroup>
        <Switch aria-label="Notifications" />
      </>,
    )
    await userEvent.type(screen.getByLabelText('Notes'), 'hello')
    expect(screen.getByLabelText('Notes')).toHaveValue('hello')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agree' }))
    expect(screen.getByRole('checkbox', { name: 'Agree' })).toHaveAttribute('data-state', 'checked')
    await userEvent.click(screen.getByRole('radio', { name: 'Plan B' }))
    expect(screen.getByRole('radio', { name: 'Plan B' })).toBeChecked()
    await userEvent.click(screen.getByRole('switch', { name: 'Notifications' }))
    expect(screen.getByRole('switch', { name: 'Notifications' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('Select renders its trigger with the placeholder', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Language">
          <SelectValue placeholder="Choose a language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent(
      'Choose a language',
    )
  })
})

describe('status and identity', () => {
  it('every status preset renders a text label (never color alone)', () => {
    for (const status of Object.keys(STATUS_PRESETS) as StatusKey[]) {
      const { unmount } = render(<StatusBadge status={status} />)
      expect(screen.getByText(STATUS_PRESETS[status].label)).toBeInTheDocument()
      unmount()
    }
  })

  it('StatusBadge label override keeps the status tone', () => {
    render(<StatusBadge status="DELIVERED" label="Delivered 2m ago" />)
    const badge = screen.getByText('Delivered 2m ago').closest('[data-slot="badge"]')!
    expect(badge).toHaveAttribute('data-status', 'DELIVERED')
    expect(badge.className).toContain('bg-success-soft')
  })

  it('Badge hides its decorative icon from assistive tech', () => {
    render(
      <Badge tone="warning" icon={<svg />}>
        Pending
      </Badge>,
    )
    expect(screen.getByText('Pending').querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('Avatar falls back to initials', () => {
    expect(initials('Priya Sharma')).toBe('PS')
    expect(initials('Madonna')).toBe('MA')
    expect(initials('  ')).toBe('?')
    render(<Avatar name="Priya Sharma" />)
    expect(screen.getByLabelText('Priya Sharma')).toHaveTextContent('PS')
  })
})

describe('layout and feedback', () => {
  it('Card, KpiCard, PageHeader, Breadcrumb render their content', () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
          </CardHeader>
          <CardContent>Body</CardContent>
        </Card>
        <KpiCard
          label="Delivered"
          value="9,712"
          delta={{ value: '+4.2%', direction: 'up', sentiment: 'positive', label: 'vs last week' }}
        />
        <PageHeader
          title="Contacts"
          description="Everyone you talk to."
          breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Contacts' }]}
          actions={<Button>Add contact</Button>}
        />
      </>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('9,712')).toBeInTheDocument()
    expect(screen.getByText('+4.2%')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(crumbs).getByText('Contacts')).toHaveAttribute('aria-current', 'page')
  })

  it('Breadcrumb uses an injected link component', () => {
    const Link = ({
      href,
      children,
      className,
    }: {
      href: string
      children: React.ReactNode
      className?: string
    }) => (
      <a href={href} className={className} data-custom="yes">
        {children}
      </a>
    )
    render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Here' }]} linkAs={Link} />)
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('data-custom', 'yes')
  })

  it('Alert uses role=alert only for danger', () => {
    render(
      <>
        <Alert tone="danger" title="Failed" />
        <Alert tone="info" title="Heads up" />
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    expect(screen.getByRole('status')).toHaveTextContent('Heads up')
  })

  it('EmptyState, ErrorState and Skeleton render', async () => {
    const onRetry = vi.fn()
    render(
      <>
        <EmptyState title="No contacts yet" description="Import a CSV to get started." />
        <ErrorState correlationId="corr-123" onRetry={onRetry} />
        <Skeleton data-testid="sk" />
      </>,
    )
    expect(screen.getByText('No contacts yet')).toBeInTheDocument()
    expect(screen.getByText('corr-123')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true')
  })

  it('Toaster mounts without errors', () => {
    render(<Toaster />)
  })
})

describe('overlays', () => {
  it('Modal opens with an accessible name and closes on Escape', async () => {
    render(
      <Modal>
        <ModalTrigger asChild>
          <Button>Open</Button>
        </ModalTrigger>
        <ModalContent title="Edit contact">Form</ModalContent>
      </Modal>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Edit contact' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Drawer renders as a labelled dialog', () => {
    render(
      <Drawer open>
        <DrawerContent title="Contact details">Body</DrawerContent>
      </Drawer>,
    )
    expect(screen.getByRole('dialog', { name: 'Contact details' })).toBeInTheDocument()
  })

  it('Dropdown opens from the keyboard and runs the item', async () => {
    const onSelect = vi.fn()
    render(
      <Dropdown>
        <DropdownTrigger asChild>
          <Button>Menu</Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={onSelect}>Rename</DropdownItem>
        </DropdownContent>
      </Dropdown>,
    )
    screen.getByRole('button', { name: 'Menu' }).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('Tooltip wraps its trigger', () => {
    render(
      <TooltipProvider>
        <Tooltip content="More info">
          <Button>Info</Button>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument()
  })

  it('Tabs switch panels with arrow keys', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Overview</TabsTrigger>
          <TabsTrigger value="b">Consent</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Overview panel</TabsContent>
        <TabsContent value="b">Consent panel</TabsContent>
      </Tabs>,
    )
    screen.getByRole('tab', { name: 'Overview' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Consent' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Consent panel')
  })
})

describe('ConfirmDialog / useConfirm', () => {
  function DeleteButton({ onResult }: { onResult: (ok: boolean) => void }) {
    const confirm = useConfirm()
    return (
      <Button
        variant="danger"
        onClick={async () =>
          onResult(
            await confirm({ title: 'Delete tag?', destructive: true, confirmLabel: 'Delete' }),
          )
        }
      >
        Delete tag
      </Button>
    )
  }

  it('resolves true on confirm and false on cancel', async () => {
    const onResult = vi.fn()
    render(
      <ConfirmProvider>
        <DeleteButton onResult={onResult} />
      </ConfirmProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete tag' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete tag?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true))

    await userEvent.click(screen.getByRole('button', { name: 'Delete tag' }))
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))
  })

  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<DeleteButton onResult={() => undefined} />)).toThrow(/ConfirmProvider/)
  })
})

describe('CommandPalette', () => {
  it('filters items and runs the selected one', async () => {
    const go = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          groups={[
            {
              heading: 'Navigation',
              items: [
                { id: 'dashboard', label: 'Dashboard', onSelect: () => go('dashboard') },
                { id: 'inbox', label: 'Inbox', onSelect: () => go('inbox') },
              ],
            },
          ]}
        />
      )
    }
    render(<Harness />)
    await userEvent.type(screen.getByPlaceholderText('Search or jump to…'), 'inb')
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(go).toHaveBeenCalledWith('inbox')
  })
})

describe('Table and DataTable', () => {
  type Row = { id: string; name: string; sent: number }
  const rows: Row[] = [
    { id: 'r1', name: 'Bravo', sent: 5 },
    { id: 'r2', name: 'Alpha', sent: 12 },
  ]
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'sent', header: 'Sent' },
  ]

  it('Table renders semantic markup', () => {
    render(
      <Table aria-label="Simple">
        <TableHeader>
          <TableRow>
            <TableHead>H</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>C</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.getByRole('table', { name: 'Simple' })).toBeInTheDocument()
  })

  it('sorts by a column and exposes aria-sort', async () => {
    render(<DataTable label="Campaigns" columns={columns} data={rows} getRowId={(r) => r.id} />)
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(within(nameHeader).getByRole('button'))
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    const firstCells = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[0]!.textContent)
    expect(firstCells).toEqual(['Alpha', 'Bravo'])
  })

  it('selects rows and reports ids', async () => {
    const onSelectionChange = vi.fn()
    render(
      <DataTable
        label="Contacts"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        selectable
        onSelectionChange={onSelectionChange}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(['r1', 'r2'])
  })

  it('shows loading, empty and error states', () => {
    const { rerender } = render(
      <DataTable label="T" columns={columns} data={[]} getRowId={(r) => r.id} loading />,
    )
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    rerender(
      <DataTable
        label="T"
        columns={columns}
        data={[]}
        getRowId={(r) => r.id}
        empty={{ title: 'No campaigns yet' }}
      />,
    )
    expect(screen.getByText('No campaigns yet')).toBeInTheDocument()
    rerender(
      <DataTable
        label="T"
        columns={columns}
        data={[]}
        getRowId={(r) => r.id}
        error={{ correlationId: 'corr-9' }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('corr-9')
  })

  it('renders cursor pagination that disables at the ends', async () => {
    const onNext = vi.fn()
    render(
      <Pagination
        hasPrevious={false}
        hasNext
        onPrevious={() => undefined}
        onNext={onNext}
        summary="Showing 1–25"
      />,
    )
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onNext).toHaveBeenCalledOnce()
  })
})
