import type { Project } from './project.mjs';

export const FULL: string;
export function commandsFor(changed: string[], project: Project): string[];
export function changedFiles(): string[];
export function unionChanged(diffOut: string, statusRaw: string): string[];
