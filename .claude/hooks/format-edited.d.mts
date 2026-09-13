export declare const ROOT: string;

export interface FixCommand {
  command: string;
  args: string[];
}

export declare function fixCommands(filePath: string): FixCommand[];

export declare function runFixes(
  filePath: string,
  options?: { exec?: (command: string, args: string[], options: unknown) => unknown },
): void;
