import { type DraftGraph } from '@fenwira/contracts'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@fenwira/ui'
import { type DraftNode } from '@/lib/automation'
const examples: Record<string, string> = {
  category: 'Clothing',
  product: 'Cotton shirt',
  preference: 'Blue, size M',
  quantity: '12',
  required_date: '2026-12-15',
  confirm: 'Confirm',
}
function example(node: DraftNode) {
  const options = node.config.options as Array<{ value: string }> | undefined
  return (
    options?.[0]?.value ??
    examples[String(node.config.field)] ??
    (node.config.answerType === 'NUMBER'
      ? '1'
      : node.config.answerType === 'DATE'
        ? '2026-12-15'
        : node.config.answerType === 'EMAIL'
          ? 'customer@example.com'
          : `Example ${String(node.config.field)}`)
  )
}
export function CollectedAnswersPreview({ graph }: { graph: DraftGraph }) {
  const fields = graph.nodes.filter(
    (n) => n.type === 'action.question' || n.type === 'action.options',
  )
  if (!fields.length) return null
  const values = Object.fromEntries(fields.map((n) => [String(n.config.field), example(n)]))
  const fill = (text: string) =>
    text.replace(
      /\{\{\s*vars\.([^{}\s]+)\s*\}\}/g,
      (_, field: string) => values[field] ?? `[${field}]`,
    )
  const review = fields.find(
    (n) =>
      n.config.field === 'confirm' ||
      /review.*enquiry|review and confirm/i.test(String(n.config.text)),
  )
  const handover = graph.nodes.find((n) => n.type === 'action.handover')
  return (
    <section aria-label="Collected-answer preview" className="flex min-w-0 flex-col gap-4">
      <h3 className="text-md font-semibold text-slate">Collected answers</h3>
      <p className="text-xs text-muted">
        Illustrative sample values. Live answers come from the customer.
      </p>
      <div className="max-w-full overflow-x-auto">
        <Table aria-label="Saved answer fields">
          <TableHeader>
            <TableRow>
              <TableHead>Field name</TableHead>
              <TableHead>Where saved</TableHead>
              <TableHead>Example value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((n) => (
              <TableRow key={n.id}>
                <TableCell>{String(n.config.field)}</TableCell>
                <TableCell>
                  {n.config.contactProperty
                    ? `Contact property: ${String(n.config.contactProperty)}`
                    : `Conversation: vars.${String(n.config.field)}`}
                </TableCell>
                <TableCell>{values[String(n.config.field)]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {review ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h4 className="text-sm font-semibold text-slate">Review and confirm · customer sees</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-secondary">
            {fill(String(review.config.text))}
          </p>
        </div>
      ) : null}
      {handover ? (
        <div className="rounded-lg border border-border bg-chat-note p-4">
          <h4 className="text-sm font-semibold text-slate">Private note · salesperson sees</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-secondary">
            {fill(String(handover.config.note ?? ''))}
          </p>
        </div>
      ) : null}
    </section>
  )
}
