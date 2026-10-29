import { Suspense } from 'react'
import { ReplyWizard } from '@/components/reply-studio/wizard'
export default function NewReplyPage() {
  return (
    <Suspense fallback={<p role="status">Loading setup…</p>}>
      <ReplyWizard />
    </Suspense>
  )
}
