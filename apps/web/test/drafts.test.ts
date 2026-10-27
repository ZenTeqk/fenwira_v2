import { describe, expect, it } from 'vitest'
import { createDraftStore } from '../lib/drafts'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    map,
  }
}

describe('draft store', () => {
  it('keeps a draft per conversation and mode while switching conversations', () => {
    const store = createDraftStore(() => memoryStorage())
    store.set('u1.t1', 'c1', 'reply', 'Hello Priya')
    store.set('u1.t1', 'c1', 'note', 'Check stock')
    store.set('u1.t1', 'c2', 'reply', 'Other customer')
    expect(store.get('u1.t1', 'c1', 'reply')).toBe('Hello Priya')
    expect(store.get('u1.t1', 'c1', 'note')).toBe('Check stock')
    expect(store.get('u1.t1', 'c2', 'reply')).toBe('Other customer')
    expect(store.get('u1.t1', 'c2', 'note')).toBe('')
  })

  it('survives a reload through storage, scoped to user and workspace', () => {
    const storage = memoryStorage()
    createDraftStore(() => storage).set('u1.t1', 'c1', 'reply', 'Kept')
    const reloaded = createDraftStore(() => storage)
    expect(reloaded.get('u1.t1', 'c1', 'reply')).toBe('Kept')
    expect(reloaded.get('u2.t1', 'c1', 'reply')).toBe('')
    expect(reloaded.get('u1.t2', 'c1', 'reply')).toBe('')
  })

  it('clears one draft after a send, and everything on sign-out', () => {
    const storage = memoryStorage()
    const store = createDraftStore(() => storage)
    store.set('u1.t1', 'c1', 'reply', 'Sent soon')
    store.set('u1.t1', 'c1', 'note', 'Stays')
    store.clear('u1.t1', 'c1', 'reply')
    expect(store.get('u1.t1', 'c1', 'reply')).toBe('')
    expect(store.get('u1.t1', 'c1', 'note')).toBe('Stays')
    store.set('u1.t2', 'c9', 'reply', 'Another workspace')
    storage.setItem('unrelated', 'x')
    store.clearAll()
    expect(store.get('u1.t1', 'c1', 'note')).toBe('')
    expect([...storage.map.keys()]).toEqual(['unrelated'])
  })

  it('still works when storage is unavailable', () => {
    const store = createDraftStore(() => {
      throw new Error('blocked')
    })
    store.set('u1.t1', 'c1', 'reply', 'Memory only')
    expect(store.get('u1.t1', 'c1', 'reply')).toBe('Memory only')
  })
})
