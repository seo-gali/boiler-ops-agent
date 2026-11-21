import type { Plugin } from '../frontend/node_modules/vite';
export function resourceIntegrity(): Plugin;
export function importMapCsp(): string;
export function verifyFile(path: string, expected: string): void;
export function sealBuild(directory: string, record?: string): void;
export function verifyBuild(directory: string, record?: string): Record<string, string>;
