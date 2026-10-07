import { Fragment } from 'react'

/** React text nodes only: sample values cannot inject HTML or links. */
export function RecipientText({
  text,
  values,
}: {
  text: string
  values?: readonly (string | undefined)[]
}) {
  const resolved = text.replace(
    /\{\{\s*(\d+)\s*\}\}/g,
    (match, index: string) => values?.[Number(index) - 1] || match,
  )
  return (
    <span className="whitespace-pre-wrap break-words">
      {resolved.split(/(```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```'))
          return (
            <code key={index} className="font-mono">
              {part.slice(3, -3)}
            </code>
          )
        if (part.startsWith('*') && part.endsWith('*'))
          return <strong key={index}>{part.slice(1, -1)}</strong>
        if (part.startsWith('_') && part.endsWith('_'))
          return <em key={index}>{part.slice(1, -1)}</em>
        if (part.startsWith('~') && part.endsWith('~'))
          return <s key={index}>{part.slice(1, -1)}</s>
        return <Fragment key={index}>{part}</Fragment>
      })}
    </span>
  )
}
