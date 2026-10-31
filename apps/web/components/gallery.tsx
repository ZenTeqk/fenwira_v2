'use client'

import {
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  type ColumnDef,
  CommandPalette,
  ConnectionState,
  DataTable,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  Label,
  MetricCard,
  Modal,
  ModalClose,
  ModalContent,
  ModalTrigger,
  PageHeader,
  PermissionState,
  RadioGroup,
  RadioGroupItem,
  SearchInput,
  SectionHeader,
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
  Timeline,
  toast,
  Tooltip,
  useConfirm,
} from '@fenwira/ui'
import {
  Info,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
  Users,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { AppLink } from './shell/app-link'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-5"
    >
      <h2 id={id} className="text-lg font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  )
}

type Campaign = {
  id: string
  name: string
  status: StatusKey
  recipients: number
  delivered: number
}
const campaigns: Campaign[] = [
  { id: 'c1', name: 'Diwali offers', status: 'RUNNING', recipients: 10000, delivered: 9712 },
  { id: 'c2', name: 'Order follow-up', status: 'COMPLETED', recipients: 2140, delivered: 2101 },
  { id: 'c3', name: 'Winter catalog', status: 'DRAFT', recipients: 0, delivered: 0 },
]
const campaignColumns: ColumnDef<Campaign, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'recipients',
    header: 'Recipients',
    cell: ({ getValue }) => (getValue() as number).toLocaleString('en-IN'),
  },
  {
    accessorKey: 'delivered',
    header: 'Delivered',
    cell: ({ getValue }) => (getValue() as number).toLocaleString('en-IN'),
  },
]

export function Gallery() {
  const confirm = useConfirm()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tableState, setTableState] = useState<'data' | 'loading' | 'empty' | 'error'>('data')
  const [lastAction, setLastAction] = useState('None yet')

  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <PageHeader
        title="Component gallery"
        description="Every @fenwira/ui component and variant. Colors come only from design tokens (docs/DESIGN_SYSTEM.md)."
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Component gallery' }]}
        linkAs={AppLink}
      />
      <p className="text-sm text-fg-muted" aria-live="polite">
        Last action: <span data-testid="last-action">{lastAction}</span>
      </p>

      <Section id="buttons" title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">
            <Trash2 aria-hidden="true" />
            Danger
          </Button>
          <Button variant="link">Link</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="secondary" aria-label="Add">
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </Section>

      <Section id="forms" title="Input, Textarea, Select, Checkbox, Radio, Switch">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Contact name" hint="As it should appear in the inbox." required>
            <Input placeholder="Priya Sharma" />
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            <Input type="email" defaultValue="priya@" />
          </Field>
          <Field label="Internal note">
            <Textarea placeholder="Visible to your team only" />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gallery-language">Template language</Label>
            <Select defaultValue="en">
              <SelectTrigger id="gallery-language">
                <SelectValue placeholder="Choose a language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi</SelectItem>
                <SelectItem value="ta">Tamil</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex items-center gap-2">
            <Checkbox id="gallery-consent" defaultChecked />
            <Label htmlFor="gallery-consent">Marketing consent</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="gallery-indeterminate" checked="indeterminate" />
            <Label htmlFor="gallery-indeterminate">Some selected</Label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">Auto-assign</legend>
            <RadioGroup defaultValue="round-robin">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="off" id="gallery-assign-off" />
                <Label htmlFor="gallery-assign-off">Off</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="round-robin" id="gallery-assign-rr" />
                <Label htmlFor="gallery-assign-rr">Round robin</Label>
              </div>
            </RadioGroup>
          </fieldset>
          <div className="flex items-center gap-2">
            <Switch id="gallery-switch" defaultChecked />
            <Label htmlFor="gallery-switch">Automation active</Label>
          </div>
        </div>
      </Section>

      <Section id="badges" title="Badge and StatusBadge">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="primary">Primary</Badge>
          <Badge tone="success" icon={<Send />}>
            Success
          </Badge>
          <Badge tone="warning" icon={<Info />}>
            Warning
          </Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_PRESETS) as StatusKey[]).map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section id="identity" title="Avatar, Tooltip, Breadcrumb">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name="Priya Sharma" size="sm" />
          <Avatar name="Arjun Mehta" size="md" />
          <Avatar name="Fenwira Workspace" size="lg" />
          <Tooltip content="Shown on hover and keyboard focus">
            <Button variant="secondary" size="sm">
              Hover me
            </Button>
          </Tooltip>
        </div>
        <Breadcrumb
          items={[
            { label: 'Contacts', href: '/dashboard' },
            { label: 'Segments', href: '/dashboard' },
            { label: 'VIP customers' },
          ]}
          linkAs={AppLink}
        />
      </Section>

      <Section id="overlays" title="Dropdown, Modal, Drawer, ConfirmDialog, Toast, CommandPalette">
        <div className="flex flex-wrap gap-3">
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="secondary" data-testid="dropdown-trigger">
                <MoreHorizontal aria-hidden="true" />
                Actions
              </Button>
            </DropdownTrigger>
            <DropdownContent align="start">
              <DropdownLabel>Contact</DropdownLabel>
              <DropdownItem onSelect={() => setLastAction('Edit')}>
                <Pencil aria-hidden="true" />
                Edit
              </DropdownItem>
              <DropdownItem onSelect={() => setLastAction('Message')}>
                <Mail aria-hidden="true" />
                Message
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem destructive onSelect={() => setLastAction('Delete')}>
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownItem>
            </DropdownContent>
          </Dropdown>

          <Modal>
            <ModalTrigger asChild>
              <Button variant="secondary">Open modal</Button>
            </ModalTrigger>
            <ModalContent
              title="Edit contact"
              description="Changes are saved to the contact record."
              footer={
                <>
                  <ModalClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </ModalClose>
                  <ModalClose asChild>
                    <Button onClick={() => setLastAction('Saved')}>Save</Button>
                  </ModalClose>
                </>
              }
            >
              <Field label="Name">
                <Input defaultValue="Priya Sharma" />
              </Field>
            </ModalContent>
          </Modal>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="secondary">Open drawer</Button>
            </DrawerTrigger>
            <DrawerContent title="Priya Sharma" description="Contact details">
              <p className="text-base text-fg">Record details render here.</p>
            </DrawerContent>
          </Drawer>

          <Button
            variant="danger"
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete this tag?',
                description: 'It will be removed from 128 contacts. This cannot be undone.',
                confirmLabel: 'Delete tag',
                destructive: true,
              })
              setLastAction(ok ? 'Tag deleted' : 'Delete cancelled')
            }}
          >
            Delete tag…
          </Button>

          <Button
            variant="secondary"
            onClick={() => toast.success('Template submitted for review')}
          >
            Show toast
          </Button>

          <Button variant="secondary" onClick={() => setPaletteOpen(true)}>
            Open command palette
          </Button>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            groups={[
              {
                heading: 'Demo',
                items: [
                  {
                    id: 'inbox',
                    label: 'Inbox',
                    icon: <MessageSquare />,
                    onSelect: () => setLastAction('Palette: Inbox'),
                  },
                  {
                    id: 'contacts',
                    label: 'Contacts',
                    icon: <Users />,
                    onSelect: () => setLastAction('Palette: Contacts'),
                  },
                ],
              },
            ]}
          />
        </div>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList aria-label="Contact sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="conversations">Conversations</TabsTrigger>
            <TabsTrigger value="consent">Consent</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">Overview panel</TabsContent>
          <TabsContent value="conversations">Conversations panel</TabsContent>
          <TabsContent value="consent">Consent panel</TabsContent>
        </Tabs>
      </Section>

      <Section id="cards" title="Card and MetricCard">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Recipients" value="10,000" hint="Snapshot at launch" />
          <MetricCard
            label="Delivered"
            value="9,712"
            delta={{
              value: '+4.2%',
              direction: 'up',
              sentiment: 'positive',
              label: 'vs last campaign',
            }}
          />
          <MetricCard
            label="Failed"
            value="58"
            delta={{
              value: '+12',
              direction: 'up',
              sentiment: 'negative',
              label: 'vs last campaign',
            }}
          />
          <MetricCard label="Read rate" value="85%" loading />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Cards are white surfaces with a border and no shadow.</CardDescription>
          </CardHeader>
          <CardContent>Card body content.</CardContent>
          <CardFooter>
            <Button size="sm">Primary action</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section id="tables" title="Table, DataTable, Pagination">
        <Table aria-label="Simple table">
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead>Contacts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>VIP</TableCell>
              <TableCell>128</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Wholesale</TableCell>
              <TableCell>42</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <RadioGroup
          aria-label="Data table state"
          value={tableState}
          onValueChange={(v) => setTableState(v as typeof tableState)}
          className="flex flex-wrap gap-4"
        >
          {(['data', 'loading', 'empty', 'error'] as const).map((state) => (
            <div key={state} className="flex items-center gap-2">
              <RadioGroupItem value={state} id={`table-state-${state}`} />
              <Label htmlFor={`table-state-${state}`} className="capitalize">
                {state}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <DataTable
          label="Campaigns"
          columns={campaignColumns}
          data={tableState === 'data' ? campaigns : []}
          getRowId={(row) => row.id}
          selectable
          onSelectionChange={(ids) => setLastAction(`Selected ${ids.length}`)}
          loading={tableState === 'loading'}
          error={
            tableState === 'error'
              ? {
                  correlationId: '01a0cf5b-b698-719a-a2cc-0f28f5086135',
                  onRetry: () => setTableState('data'),
                }
              : undefined
          }
          empty={{
            title: 'No campaigns yet',
            description: 'Create a campaign to message a segment.',
          }}
          pagination={{
            hasPrevious: false,
            hasNext: true,
            onPrevious: () => undefined,
            onNext: () => setLastAction('Next page'),
            summary: 'Showing 1–3',
          }}
        />
      </Section>

      <Section id="feedback" title="Alert, EmptyState, ErrorState, Skeleton">
        <div className="flex flex-col gap-3">
          <Alert tone="info" title="Human takeover">
            Automation is paused while an agent handles this conversation.
          </Alert>
          <Alert tone="success" title="Connected">
            Your WhatsApp number is live.
          </Alert>
          <Alert tone="warning" title="Quality rating: Yellow">
            Reduce marketing volume to protect your number.
          </Alert>
          <Alert
            tone="danger"
            title="Template rejected"
            action={
              <Button size="sm" variant="secondary">
                Edit
              </Button>
            }
          >
            Meta flagged the body as promotional for a UTILITY template.
          </Alert>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <EmptyState
              title="No segments yet"
              description="Save a contact filter to reuse it."
              action={<Button size="sm">Create segment</Button>}
            />
          </Card>
          <Card>
            <ErrorState
              correlationId="01a0cf5b-b6ff-7029-baf9-e6e3f1e01b85"
              onRetry={() => setLastAction('Retried')}
            />
          </Card>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Section>
      <Section id="v1-composites" title="Design System v1 composites">
        <div className="flex flex-col gap-4">
          <FilterBar activeCount={1} onClear={() => setLastAction('Cleared filters')}>
            <SearchInput label="Search gallery" value="asha" onValueChange={() => undefined} />
            <Button variant="secondary" size="sm">
              Filter
            </Button>
          </FilterBar>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <ConnectionState
                status="CONNECTED"
                name="+91 98123 45671"
                detail="Quality: High"
                action={
                  <Button variant="secondary" size="sm">
                    Manage
                  </Button>
                }
              />
            </Card>
            <Card className="p-5">
              <ConnectionState status="DISCONNECTED" name="+91 98123 45672" />
            </Card>
          </div>
          <SectionHeader
            title="Section title"
            description="Section description in secondary text."
          />
          <Card className="p-5">
            <Timeline
              label="Example timeline"
              items={[
                { id: '1', title: 'Trigger matched', status: 'SUCCEEDED', time: '10:02' },
                { id: '2', title: 'Wait 1 hour', status: 'WAITING', time: '10:02' },
                {
                  id: '3',
                  title: 'Send template',
                  status: 'FAILED',
                  description: 'Not enough credits to send this template.',
                },
              ]}
            />
          </Card>
          <Card>
            <PermissionState what="billing" permission="billing.read" />
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard label="Open conversations" value="42" hint="Go to inbox" />
            <MetricCard
              label="Delivery health"
              value="High"
              delta={{
                value: '+2%',
                direction: 'up',
                sentiment: 'positive',
                label: 'vs last week',
              }}
            />
          </div>
        </div>
      </Section>
    </main>
  )
}
