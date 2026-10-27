'use client'
import { type PlatformMe } from '@fenwira/contracts'
import { createContext, useContext } from 'react'

/** The signed-in operator, provided by PlatformShell. Separate so identity.tsx can read it without
 * importing the shell (which renders IdentityProvider). */
export const PlatformContext = createContext<PlatformMe | null>(null)
export const usePlatform = () => useContext(PlatformContext)
