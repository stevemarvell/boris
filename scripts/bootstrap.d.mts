import type { Project } from './project.mjs';

export declare function installCommands(project: Project): string[];
export declare const STAMP: string;
export declare function writeStamps(root: string, project: Project): void;
