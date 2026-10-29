import { keywordMatches, type KeywordConfig, type Overlap, type OverlapFlow } from './matching'
export type FlowExplanation = { code: string; text: string }
export function explainKeywordMatch(config: KeywordConfig, message: string): FlowExplanation {
  const matched = keywordMatches(config, message)
  const keyword =
    config.keywords.find((k) => keywordMatches({ ...config, keywords: [k] }, message)) ??
    config.keywords[0] ??
    ''
  const mode = {
    EXACT: 'exact phrase',
    WHOLE_WORD: 'whole-word',
    CONTAINS: 'contains',
    STARTS_WITH: 'starts-with',
  }[config.match]
  return {
    code: matched ? 'KEYWORD_MATCHED' : 'KEYWORD_NOT_MATCHED',
    text: matched
      ? `Matched “${keyword}” using ${mode} matching.`
      : `“${message}” did not match “${config.keywords.join('”, “')}” in ${mode} mode.`,
  }
}
export function explainOverlap(
  overlap: Overlap,
  current: Pick<OverlapFlow, 'id' | 'name' | 'priority'>,
): string {
  if (overlap.kind === 'SUPPRESSES')
    return `Keyword beats Message received: ${overlap.suppressed === current.id ? `“${overlap.flow.name}” runs instead of “${current.name}”` : `“${current.name}” runs instead of “${overlap.flow.name}”`} when a keyword matches.`
  const first = overlap.first === current.id ? current : overlap.flow
  const tie = overlap.flow.priority === current.priority
  return `“${current.name}” and “${overlap.flow.name}” can match the same message. “${first.name}” runs first ${tie ? 'because priorities tie; the older rule wins, then its ID' : `because priority ${first.priority} is lower`}. Both run one after another.`
}
export function explainStep(
  nodeType: string,
  handle: string | null,
  summary: string,
): FlowExplanation {
  if (nodeType.startsWith('condition.'))
    return {
      code: handle === 'yes' ? 'CONDITION_PASSED' : 'CONDITION_NOT_PASSED',
      text: `Condition ${handle === 'yes' ? 'passed' : 'did not pass'}. ${summary}`,
    }
  return {
    code: nodeType.startsWith('trigger.') ? 'TRIGGER_MATCHED' : 'DRY_RUN_STEP',
    text: summary,
  }
}
