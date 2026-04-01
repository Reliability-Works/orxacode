import { spawn, type IPty } from 'node-pty'

export type NativePtyProcess = IPty

export const spawnNativePty = spawn
