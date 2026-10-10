'use client'

import { type ImportJob, type ImportTarget } from '@fenwira/contracts'
import {
  Alert,
  Button,
  type ColumnDef,
  DataTable,
  Label,
  ListPage,
  Modal,
  ModalContent,
  PermissionState,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { type ChangeEvent, useEffect, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { ApiError, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { formatDateTime, useProperties } from '@/lib/contacts'
import { useRealtimeEvent } from '@/lib/realtime'

const CORE_TARGETS: Array<{ value: ImportTarget; label: string }> = [
  { value: 'phone', label: 'Phone' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'language', label: 'Language' },
  { value: 'country', label: 'Country' },
  { value: 'tags', label: 'Tags (comma separated)' },
  { value: 'consent.marketing', label: 'Marketing consent (yes/no)' },
]
const STATUS_TEXT: Record<ImportJob['status'], string> = {
  UPLOADED: 'Reading file',
  MAPPING: 'Map columns',
  VALIDATING: 'Checking rows',
  PREVIEW_READY: 'Ready to import',
  IMPORTING: 'Importing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}
const BUSY = new Set<ImportJob['status']>(['UPLOADED', 'VALIDATING', 'IMPORTING'])
const n = (v: number) => v.toLocaleString()

function useImport(id: string | null) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'import', id ?? ''),
    queryFn: () => get<{ data: ImportJob }>(`/imports/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && BUSY.has(q.state.data.status) ? 1000 : false),
  })
}

function MappingStep({ job, onDone }: { job: ImportJob; onDone: () => void }) {
  const props = (useProperties().data ?? []).filter((p) => !p.archived)
  const [mapping, setMapping] = useState<Record<string, ImportTarget>>(
    job.columnMapping ?? job.suggestedMapping,
  )
  const [policy, setPolicy] = useState<'SKIP' | 'UPDATE'>(job.duplicatePolicy)
  const [consent, setConsent] = useState<string>(job.defaultConsent?.marketing ?? 'NONE')
  const save = useMutation({
    mutationFn: () =>
      patch(`/imports/${job.id}`, {
        columnMapping: mapping,
        duplicatePolicy: policy,
        defaultConsent: consent === 'NONE' ? null : { marketing: consent },
      }),
    onSuccess: onDone,
  })
  return (
    <div className="flex flex-col gap-4">
      <FormError error={save.error} />
      <table className="w-full text-left" aria-label="Column mapping">
        <thead className="text-sm text-muted">
          <tr>
            <th className="py-2 font-medium">Column in your file</th>
            <th className="py-2 font-medium">Saves to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {job.headers.map((h) => (
            <tr key={h}>
              <td className="py-2 pr-4 text-slate">{h}</td>
              <td className="py-2">
                <Select
                  value={mapping[h] ?? 'ignore'}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v as ImportTarget }))}
                >
                  <SelectTrigger className="h-9 w-64" aria-label={`Target for ${h}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ignore">Don&apos;t import</SelectItem>
                    <SelectGroup>
                      <SelectLabel>Contact</SelectLabel>
                      {CORE_TARGETS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {props.length ? (
                      <SelectGroup>
                        <SelectLabel>Custom fields</SelectLabel>
                        {props.map((p) => (
                          <SelectItem key={p.key} value={`property.${p.key}`}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-slate">
          When a phone number already exists
        </legend>
        <RadioGroup value={policy} onValueChange={(v) => setPolicy(v as 'SKIP' | 'UPDATE')}>
          <label className="flex items-center gap-2 text-sm text-slate">
            <RadioGroupItem value="SKIP" /> Skip the row
          </label>
          <label className="flex items-center gap-2 text-sm text-slate">
            <RadioGroupItem value="UPDATE" /> Update the contact with the file&apos;s values
          </label>
        </RadioGroup>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-consent">Marketing consent when the file doesn&apos;t say</Label>
        <Select value={consent} onValueChange={setConsent}>
          <SelectTrigger id="default-consent" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">Leave unset</SelectItem>
            <SelectItem value="GRANTED">Opted in</SelectItem>
            <SelectItem value="REVOKED">Opted out</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button className="self-end" loading={save.isPending} onClick={() => save.mutate()}>
        Check rows
      </Button>
    </div>
  )
}

function PreviewStep({
  job,
  onImport,
  importing,
}: {
  job: ImportJob
  onImport: () => void
  importing: boolean
}) {
  const c = job.counts
  return (
    <div className="flex flex-col gap-4">
      <Alert
        tone={c.invalid ? 'warning' : 'success'}
        title={`${n(c.valid)} of ${n(c.total)} rows are ready`}
      >
        {n(c.new)} new contacts, {n(c.existing)} already exist
        {job.duplicatePolicy === 'SKIP' ? ' (skipped)' : ' (updated)'}
        {c.invalid ? `, ${n(c.invalid)} rows have problems and will be left out.` : '.'}
      </Alert>
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-sm" aria-label="Preview of the first rows">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr>
              <th className="p-2 font-medium">Row</th>
              {job.headers.map((h) => (
                <th key={h} className="p-2 font-medium">
                  {h}
                </th>
              ))}
              <th className="p-2 font-medium">Problems</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(job.preview ?? []).map((r) => (
              <tr key={r.row} className={r.errors.length ? 'bg-danger-soft' : undefined}>
                <td className="p-2 text-muted">{r.row}</td>
                {job.headers.map((h) => (
                  <td key={h} className="p-2 text-slate">
                    {r.values[h]}
                  </td>
                ))}
                <td className="p-2 text-slate">{r.errors.map((e) => e.message).join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button className="self-end" loading={importing} disabled={!c.valid} onClick={onImport}>
        Import {n(c.valid)} contacts
      </Button>
    </div>
  )
}

function ImportWizard({
  jobId,
  onJob,
  onClose,
}: {
  jobId: string | null
  onJob: (id: string) => void
  onClose: () => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const job = useImport(jobId)
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null)
  useRealtimeEvent<{ importJobId: string; processed: number; total: number }>(
    'import.progress',
    (e) => {
      if (e.importJobId === jobId) setProgress(e)
    },
  )
  useEffect(() => setProgress(null), [jobId])
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'import', jobId ?? '') })
    void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'imports') })
  }
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const target = await post<{
        data: { fileId: string; url: string; headers: Record<string, string> }
      }>('/imports/upload-url', {
        mimeType: file.type || 'text/csv',
        sizeBytes: file.size,
        filename: file.name,
      })
      const put = await fetch(target.data.url, {
        method: 'PUT',
        headers: target.data.headers,
        body: file,
      })
      if (!put.ok) throw new Error('The upload failed. Try again.')
      return post<{ data: ImportJob }>('/imports', { fileId: target.data.fileId })
    },
    onSuccess: (res) => {
      onJob(res.data.id)
      refresh()
    },
  })
  const confirm = useMutation({
    mutationFn: () => post(`/imports/${jobId}/confirm`),
    onSuccess: refresh,
  })
  const cancel = useMutation({
    mutationFn: () => post(`/imports/${jobId}/cancel`),
    onSuccess: refresh,
  })
  const report = useMutation({
    mutationFn: () => get<{ data: { url: string } }>(`/imports/${jobId}/error-report`),
    onSuccess: (r) => window.location.assign(r.data.url),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not download the report.'),
  })
  const j = job.data

  let body
  if (!jobId)
    body = (
      <div className="flex flex-col gap-3">
        <FormError error={upload.error} />
        <p className="text-base text-slate">
          Upload a CSV (up to 100,000 rows, 50 MB) with a header row. Phone numbers without a
          country code use the workspace country.
        </p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center text-slate hover:bg-neutral-soft">
          <Upload aria-hidden="true" className="size-6 text-muted" />
          <span>{upload.isPending ? 'Uploading…' : 'Choose a CSV file'}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="CSV file"
            disabled={upload.isPending}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f)
            }}
          />
        </label>
      </div>
    )
  else if (!j) body = <p className="text-muted">Loading…</p>
  else if (j.status === 'MAPPING') body = <MappingStep job={j} onDone={refresh} />
  else if (j.status === 'PREVIEW_READY')
    body = <PreviewStep job={j} importing={confirm.isPending} onImport={() => confirm.mutate()} />
  else if (BUSY.has(j.status)) {
    const done = progress?.processed ?? j.counts.processed
    const total = j.counts.total || progress?.total || 0
    body = (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="text-base text-slate">
          {STATUS_TEXT[j.status]}
          {j.status === 'IMPORTING' && total ? ` — ${n(done)} of ${n(total)} rows` : '…'}
        </p>
        {j.status === 'IMPORTING' ? (
          <>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-neutral-soft"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label="Import progress"
            >
              <div
                className="h-full bg-primary-strong transition-all"
                style={{ width: `${total ? (100 * done) / total : 0}%` }}
              />
            </div>
            <Button
              variant="secondary"
              className="self-end"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Stop import
            </Button>
          </>
        ) : null}
      </div>
    )
  } else
    body = (
      <div className="flex flex-col gap-4">
        {j.status === 'FAILED' ? (
          <Alert tone="danger" title="The import failed">
            {j.failureReason}
          </Alert>
        ) : (
          <Alert
            tone={j.status === 'COMPLETED' ? 'success' : 'warning'}
            title={STATUS_TEXT[j.status]}
          >
            {n(j.counts.created)} created, {n(j.counts.updated)} updated, {n(j.counts.skipped)}{' '}
            skipped, {n(j.counts.invalid)} with problems.
          </Alert>
        )}
        {j.hasErrorReport ? (
          <Button
            variant="secondary"
            className="self-start"
            loading={report.isPending}
            onClick={() => report.mutate()}
          >
            Download rows with problems
          </Button>
        ) : null}
      </div>
    )

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent
        title="Import contacts"
        description={j?.filename ?? undefined}
        className="max-w-3xl"
      >
        {body}
      </ModalContent>
    </Modal>
  )
}

export default function ImportsPage() {
  const { tenantId, can } = useSession()
  const [wizard, setWizard] = useState<{ id: string | null } | null>(null)
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('job')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setWizard({ id })
  }, [])
  const imports = useQuery({
    queryKey: keys.tenant(tenantId, 'imports'),
    queryFn: () => get<{ data: ImportJob[] }>('/imports').then((r) => r.data),
    enabled: can('contacts.import'),
    refetchInterval: (q) => (q.state.data?.some((j) => BUSY.has(j.status)) ? 2000 : false),
  })
  if (!can('contacts.import')) return <PermissionState what="imports" />
  const columns: ColumnDef<ImportJob, unknown>[] = [
    { id: 'file', header: 'File', cell: ({ row }) => row.original.filename ?? 'Untitled.csv' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = row.original.status
        const badge =
          s === 'COMPLETED'
            ? 'COMPLETED'
            : s === 'FAILED'
              ? 'FAILED'
              : s === 'CANCELLED'
                ? 'STOPPED'
                : 'PENDING'
        return <StatusBadge status={badge} label={STATUS_TEXT[s]} />
      },
    },
    {
      id: 'counts',
      header: 'Result',
      cell: ({ row }) => {
        const c = row.original.counts
        return row.original.status === 'COMPLETED'
          ? `${n(c.created)} created · ${n(c.updated)} updated · ${n(c.skipped)} skipped · ${n(c.invalid)} invalid`
          : `${n(c.total)} rows`
      },
    },
    { id: 'created', header: 'Started', cell: ({ row }) => formatDateTime(row.original.createdAt) },
    {
      id: 'open',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setWizard({ id: row.original.id })}>
            {['MAPPING', 'PREVIEW_READY'].includes(row.original.status) ? 'Continue' : 'Open'}
          </Button>
        </div>
      ),
    },
  ]
  return (
    <ListPage
      header={{
        title: 'Imports',
        description: 'Bring contacts in from a CSV file.',
        actions: (
          <Button onClick={() => setWizard({ id: null })}>
            <Upload aria-hidden="true" />
            Import contacts
          </Button>
        ),
      }}
    >
      <DataTable
        label="Imports"
        columns={columns}
        data={imports.data ?? []}
        getRowId={(j) => j.id}
        loading={imports.isPending}
        empty={{ title: 'No imports yet', description: 'Upload a CSV to add contacts in bulk.' }}
      />
      {wizard ? (
        <ImportWizard
          jobId={wizard.id}
          onJob={(id) => setWizard({ id })}
          onClose={() => setWizard(null)}
        />
      ) : null}
    </ListPage>
  )
}
