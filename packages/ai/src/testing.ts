/**
 * Builds a minimal valid PDF for tests: one page per entry, each line drawn as text (Helvetica).
 * An empty string makes a page with no text layer (what a scanned page looks like to us).
 */
export function makeTestPdf(pages: string[]): Uint8Array {
  const objects: string[] = []
  const pageIds: number[] = []
  const font = 3 + pages.length * 2
  pages.forEach((text, i) => {
    const pageId = 3 + i * 2
    const contentId = pageId + 1
    pageIds.push(pageId)
    const lines = text
      .split('\n')
      .map(
        (l, j) =>
          `BT /F1 12 Tf 50 ${750 - j * 16} Td (${l.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`,
      )
      .join('\n')
    const stream = text ? lines : ''
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[font] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++)
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}
