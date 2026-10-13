// A provider child's own temp folder. Descendants it leaves behind can keep using it, so it goes only
// on proof they are all gone: a close that saw the whole tree exit, or a later boot. Else it stays.

import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSessionProcessIdentity } from '../../shared/agent-session-record'
import {
  BootIdentitySchema,
  provesPreviousBoot,
  type BootIdentity
} from '../../shared/automatic-work-run-marker'
import { readBootIdentity } from '../daemon/automatic-work-run-marker-store'

const BOOT_FILE = 'boot.json'

export function providerPrivateTempRoot(stateDirectory: string): string {
  return join(stateDirectory, 'provider-temp')
}

export type ProviderPrivateTempDirectory = {
  env: Record<string, string>
  recordOwner(process: AgentSessionProcessIdentity): void
  remove(): void
}

/** Made before the spawn, with the boot it belongs to on record, so a crash at any later point
 *  still leaves the evidence a later boot's sweep needs. */
export function createProviderPrivateTempDirectory(root: string): ProviderPrivateTempDirectory {
  const folder = join(
    root,
    `${process.pid}-${Math.round(performance.timeOrigin)}-${randomBytes(4).toString('hex')}`
  )
  // The child's temp is a subfolder so nothing it writes can replace Orca's records.
  const temp = join(folder, 'tmp')
  try {
    mkdirSync(temp, { recursive: true })
    writeFileSync(join(folder, BOOT_FILE), JSON.stringify(readBootIdentity()))
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    throw error
  }
  return {
    env: { TMPDIR: temp, TEMP: temp, TMP: temp },
    recordOwner: (owner) => {
      void writeFile(join(folder, 'owner.json'), JSON.stringify(owner)).catch(() => {})
    },
    remove: () => {
      void rm(folder, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** Removes the folders an earlier boot made; same-boot or unknown evidence keeps them. */
export async function sweepProviderPrivateTempDirectories(
  root: string,
  current: BootIdentity = readBootIdentity()
): Promise<void> {
  for (const entry of await readdir(root).catch(() => [])) {
    const folder = join(root, entry)
    try {
      const recorded = BootIdentitySchema.parse(
        JSON.parse(await readFile(join(folder, BOOT_FILE), 'utf8'))
      )
      if (provesPreviousBoot(recorded, current)) {
        await rm(folder, { recursive: true, force: true })
      }
    } catch {
      // Unreadable evidence keeps the folder; one failure never stops the rest.
    }
  }
}
