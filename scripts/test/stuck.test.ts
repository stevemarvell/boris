import { describe, expect, it } from 'vitest';
import {
  MAX_MERGES_BEHIND,
  aheadCount,
  allPullRequests,
  behindMergeCount,
  find,
  gh,
  git,
  isEmpty,
  localBranches,
  mergedWorktrees,
  noChecksRegistered,
  orphanedBranches,
  parseWorktreeList,
  remoteBranches,
  render,
  renderFindings,
  staleOrConflicting,
  untrackedWorktreeFolders,
  worktreeList,
  type PullRequest,
  type Run,
} from '../stuck.mjs';

const pr = (overrides: Partial<PullRequest>): PullRequest => ({
  number: 1,
  title: 'a pull request',
  state: 'OPEN',
  headRefName: 'feat/x',
  ...overrides,
});

const emptyFindings = () => ({
  orphanedBranches: [],
  untrackedWorktrees: [],
  mergedWorktrees: [],
  staleOrConflicting: [],
  noChecksRegistered: [],
});

describe('localBranches / remoteBranches', () => {
  it('parses one name per line and drops blanks', async () => {
    const run: Run = async () => ({ status: 0, stdout: 'develop\nfeat/x\n\n', stderr: '' });
    expect(await localBranches(run)).toEqual(['develop', 'feat/x']);
  });

  it('strips the origin/ prefix and excludes origin/HEAD', async () => {
    const run: Run = async () => ({ status: 0, stdout: 'origin/develop\norigin/feat/x\norigin/HEAD\n', stderr: '' });
    expect(await remoteBranches(run)).toEqual(['develop', 'feat/x']);
  });

  it('throws with the injected stderr when git fails', async () => {
    const run: Run = async () => ({ status: 1, stdout: '', stderr: 'not a git repository' });
    await expect(localBranches(run)).rejects.toThrow(/not a git repository/);
    await expect(remoteBranches(run)).rejects.toThrow(/not a git repository/);
  });
});

describe('aheadCount / behindMergeCount', () => {
  it('parses the count git prints', async () => {
    const run: Run = async () => ({ status: 0, stdout: '3\n', stderr: '' });
    expect(await aheadCount(run, 'origin/develop', 'feat/x')).toBe(3);
    expect(await behindMergeCount(run, 'origin/develop', 'feat/x')).toBe(3);
  });

  it('is null, not a guess, when the ref cannot be resolved', async () => {
    const run: Run = async () => ({ status: 128, stdout: '', stderr: "unknown revision 'feat/gone'" });
    expect(await aheadCount(run, 'origin/develop', 'feat/gone')).toBeNull();
    expect(await behindMergeCount(run, 'origin/develop', 'feat/gone')).toBeNull();
  });
});

describe('parseWorktreeList', () => {
  it('parses worktree/branch pairs, including a detached one with no branch line', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/develop',
      '',
      'worktree /repo/.claude/worktrees/agent-1',
      'HEAD def456',
      'branch refs/heads/feat/x',
      '',
      'worktree /repo/.claude/worktrees/detached',
      'HEAD abc123',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/repo', branch: 'develop' },
      { path: '/repo/.claude/worktrees/agent-1', branch: 'feat/x' },
      { path: '/repo/.claude/worktrees/detached', branch: null },
    ]);
  });
});

describe('worktreeList', () => {
  it('throws with the injected stderr when git fails', async () => {
    const run: Run = async () => ({ status: 1, stdout: '', stderr: 'no worktrees' });
    await expect(worktreeList(run)).rejects.toThrow(/no worktrees/);
  });
});

describe('allPullRequests', () => {
  it('passes --state all and parses gh pr list output', async () => {
    const calls: string[][] = [];
    const run: Run = async (args) => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify([pr({ number: 7 })]), stderr: '' };
    };
    expect(await allPullRequests(run)).toEqual([pr({ number: 7 })]);
    expect(calls[0]).toContain('all');
  });

  it('throws with the injected stderr on failure', async () => {
    const run: Run = async () => ({ status: 1, stdout: '', stderr: 'HTTP 401' });
    await expect(allPullRequests(run)).rejects.toThrow(/HTTP 401/);
  });
});

describe('orphanedBranches', () => {
  it('reports a branch ahead of develop with no pull request at all, open or closed', () => {
    const result = orphanedBranches(
      { local: [{ name: 'feat/orphan', ahead: 2 }] },
      [pr({ headRefName: 'feat/other', state: 'CLOSED' })],
    );
    expect(result).toEqual([{ name: 'feat/orphan', ahead: 2, where: 'local' }]);
  });

  it('is not fooled by a closed pull request: a branch with any PR at all is not orphaned', () => {
    const result = orphanedBranches(
      { local: [{ name: 'feat/x', ahead: 2 }] },
      [pr({ headRefName: 'feat/x', state: 'CLOSED' })],
    );
    expect(result).toEqual([]);
  });

  it('never reports a branch with nothing ahead of develop', () => {
    expect(orphanedBranches({ local: [{ name: 'develop', ahead: 0 }] }, [])).toEqual([]);
  });

  it('never reports a branch whose ahead count is unknown', () => {
    expect(orphanedBranches({ local: [{ name: 'feat/gone', ahead: null }] }, [])).toEqual([]);
  });

  it('reports a branch present both locally and remotely once, naming both', () => {
    const result = orphanedBranches(
      { local: [{ name: 'feat/x', ahead: 1 }], remote: [{ name: 'feat/x', ahead: 3 }] },
      [],
    );
    expect(result).toEqual([{ name: 'feat/x', ahead: 3, where: 'local and remote' }]);
  });

  it('sorts by name', () => {
    const result = orphanedBranches(
      { local: [{ name: 'zeta', ahead: 1 }, { name: 'alpha', ahead: 1 }] },
      [],
    );
    expect(result.map((b) => b.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('untrackedWorktreeFolders', () => {
  it('reports a folder git worktree list does not track', () => {
    const result = untrackedWorktreeFolders(
      ['agent-1', 'agent-2-leftover'],
      ['/repo/.claude/worktrees/agent-1'],
    );
    expect(result).toEqual(['agent-2-leftover']);
  });

  it('matches on the registered path\'s basename regardless of slash direction', () => {
    const result = untrackedWorktreeFolders(['agent-1'], ['C:\\repo\\.claude\\worktrees\\agent-1']);
    expect(result).toEqual([]);
  });

  it('reports nothing when every folder on disk is registered', () => {
    expect(untrackedWorktreeFolders([], [])).toEqual([]);
  });
});

describe('mergedWorktrees', () => {
  it('reports a registered worktree whose branch pull request has merged', () => {
    const worktrees = [{ path: '/repo/.claude/worktrees/agent-1', branch: 'feat/done' }];
    const prs = [pr({ number: 42, headRefName: 'feat/done', state: 'MERGED' })];
    expect(mergedWorktrees(worktrees, prs)).toEqual([{ path: '/repo/.claude/worktrees/agent-1', branch: 'feat/done', pr: 42 }]);
  });

  it('does not report a worktree whose pull request is still open', () => {
    const worktrees = [{ path: '/repo/.claude/worktrees/agent-1', branch: 'feat/wip' }];
    const prs = [pr({ headRefName: 'feat/wip', state: 'OPEN' })];
    expect(mergedWorktrees(worktrees, prs)).toEqual([]);
  });

  it('does not report a detached worktree, which has no branch to check', () => {
    expect(mergedWorktrees([{ path: '/repo/x', branch: null }], [])).toEqual([]);
  });
});

describe('staleOrConflicting', () => {
  it('reports an open PR whose mergeable is CONFLICTING', () => {
    const result = staleOrConflicting([pr({ mergeable: 'CONFLICTING' })]);
    expect(result).toEqual([{ number: 1, title: 'a pull request', reasons: ['mergeable is CONFLICTING'] }]);
  });

  it('reports an open PR whose mergeable is UNKNOWN', () => {
    const result = staleOrConflicting([pr({ mergeable: 'UNKNOWN' })]);
    expect(result[0]!.reasons).toEqual(['mergeable is UNKNOWN']);
  });

  it('does not report a MERGEABLE open PR', () => {
    expect(staleOrConflicting([pr({ mergeable: 'MERGEABLE' })])).toEqual([]);
  });

  it(`reports an open PR more than ${MAX_MERGES_BEHIND} merges behind develop`, () => {
    const behind = new Map([[1, 3]]);
    const result = staleOrConflicting([pr({ mergeable: 'MERGEABLE' })], behind);
    expect(result[0]!.reasons).toEqual(['3 merges behind develop']);
  });

  it(`does not report an open PR exactly ${MAX_MERGES_BEHIND} merges behind`, () => {
    const behind = new Map([[1, MAX_MERGES_BEHIND]]);
    expect(staleOrConflicting([pr({ mergeable: 'MERGEABLE' })], behind)).toEqual([]);
  });

  it('never reports a closed or merged pull request', () => {
    expect(staleOrConflicting([pr({ mergeable: 'CONFLICTING', state: 'CLOSED' })])).toEqual([]);
    expect(staleOrConflicting([pr({ mergeable: 'CONFLICTING', state: 'MERGED' })])).toEqual([]);
  });

  it('treats an unknown behind count as unknown, not as clean or stale', () => {
    const behind = new Map([[1, null]]);
    expect(staleOrConflicting([pr({ mergeable: 'MERGEABLE' })], behind)).toEqual([]);
  });

  it('reports both reasons together when both apply', () => {
    const behind = new Map([[1, 5]]);
    const result = staleOrConflicting([pr({ mergeable: 'CONFLICTING' })], behind);
    expect(result[0]!.reasons).toEqual(['mergeable is CONFLICTING', '5 merges behind develop']);
  });
});

describe('noChecksRegistered', () => {
  it('reports an open PR with an empty statusCheckRollup', () => {
    expect(noChecksRegistered([pr({ statusCheckRollup: [] })])).toEqual([pr({ statusCheckRollup: [] })]);
  });

  it('reports an open PR with no statusCheckRollup field at all', () => {
    expect(noChecksRegistered([pr({})])).toEqual([pr({})]);
  });

  it('does not report an open PR with at least one check', () => {
    expect(noChecksRegistered([pr({ statusCheckRollup: [{ name: 'verify' }] })])).toEqual([]);
  });

  it('never reports a closed or merged pull request', () => {
    expect(noChecksRegistered([pr({ state: 'CLOSED' })])).toEqual([]);
  });
});

describe('isEmpty', () => {
  it('is true for findings with nothing in any list', () => {
    expect(isEmpty(emptyFindings())).toBe(true);
  });

  it('is false when any one list has an entry', () => {
    expect(isEmpty({ ...emptyFindings(), orphanedBranches: [{ name: 'x', ahead: 1, where: 'local' }] })).toBe(false);
  });
});

describe('render / renderFindings', () => {
  it('says nothing is stuck when every list is empty', () => {
    expect(render(emptyFindings())).toContain('nothing stuck');
    expect(renderFindings(emptyFindings())).toEqual([]);
  });

  it('gives one line per finding, naming a next action', () => {
    const findings = {
      orphanedBranches: [{ name: 'feat/orphan', ahead: 2, where: 'local' }],
      untrackedWorktrees: [{ name: 'agent-leftover', entryCount: 4, hasChanges: true }],
      mergedWorktrees: [{ path: '/repo/.claude/worktrees/agent-1', branch: 'feat/done', pr: 42 }],
      staleOrConflicting: [{ number: 9, title: 'stale', reasons: ['mergeable is CONFLICTING'] }],
      noChecksRegistered: [pr({ number: 10, title: 'no checks' })],
    };
    const lines = renderFindings(findings);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("'feat/orphan'");
    expect(lines[0]).toContain('open one');
    expect(lines[1]).toContain('agent-leftover');
    expect(lines[1]).toContain('4 entries');
    expect(lines[1]).toContain('uncommitted changes');
    expect(lines[2]).toContain('#42');
    expect(lines[2]).toContain('git worktree remove');
    expect(lines[3]).toContain('#9');
    expect(lines[3]).toContain('merge develop into the branch');
    expect(lines[4]).toContain('#10');
    expect(lines[4]).toContain('mergeStateStatus');
    expect(render(findings).trim().split('\n')).toHaveLength(5);
  });

  it('never suggests deleting or removing anything itself: it only reports', () => {
    const findings = {
      orphanedBranches: [{ name: 'feat/orphan', ahead: 2, where: 'local' }],
      untrackedWorktrees: [{ name: 'agent-leftover', entryCount: 0, hasChanges: false }],
      mergedWorktrees: [{ path: '/repo/x', branch: 'feat/done', pr: 1 }],
      staleOrConflicting: [],
      noChecksRegistered: [],
    };
    // Every suggested action is phrased as something a person or a later
    // command does ("open one", "run `git worktree remove`"); this script
    // itself must never call a destructive command to get there.
    expect(renderFindings(findings).join('\n')).not.toMatch(/\bgit branch -D\b|\brm -rf\b/);
  });
});

describe('find', () => {
  it('wires gh, git and filesystem together into one set of findings, with no network calls of its own', async () => {
    const gitCalls: string[][] = [];
    const fakeGit: Run = async (args) => {
      gitCalls.push(args);
      if (args[0] === 'for-each-ref' && args.includes('refs/heads')) {
        return { status: 0, stdout: 'develop\nfeat/orphan\n', stderr: '' };
      }
      if (args[0] === 'for-each-ref' && args.includes('refs/remotes/origin')) {
        return { status: 0, stdout: 'origin/develop\n', stderr: '' };
      }
      if (args[0] === 'worktree') {
        return {
          status: 0,
          stdout: ['worktree /repo', 'branch refs/heads/develop', '', 'worktree /repo/.claude/worktrees/agent-1', 'branch refs/heads/feat/merged', ''].join('\n'),
          stderr: '',
        };
      }
      if (args[0] === 'rev-list' && args.includes('--first-parent')) {
        return { status: 0, stdout: '0\n', stderr: '' };
      }
      if (args[0] === 'rev-list') {
        // develop..feat/orphan is ahead by 2; everything else is ahead by 0.
        return { status: 0, stdout: args.join(' ').includes('feat/orphan') ? '2\n' : '0\n', stderr: '' };
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    };
    const fakeGh: Run = async () => ({
      status: 0,
      stdout: JSON.stringify([
        pr({ number: 42, headRefName: 'feat/merged', state: 'MERGED' }),
        pr({ number: 43, headRefName: 'feat/open', state: 'OPEN', mergeable: 'CONFLICTING', statusCheckRollup: [] }),
      ]),
      stderr: '',
    });
    const readDirCalls: string[] = [];
    const readDir = (dir: string) => {
      readDirCalls.push(dir);
      if (dir.endsWith('worktrees')) return ['agent-1', 'agent-leftover'];
      if (dir.endsWith('agent-leftover')) return ['one.txt', 'two.txt'];
      return [];
    };
    const gitStatus = async (dir: string) => dir.endsWith('agent-leftover');

    const findings = await find({ gh: fakeGh, git: fakeGit, readDir, gitStatus });

    expect(findings.orphanedBranches).toEqual([{ name: 'feat/orphan', ahead: 2, where: 'local' }]);
    expect(findings.untrackedWorktrees).toEqual([{ name: 'agent-leftover', entryCount: 2, hasChanges: true }]);
    expect(findings.mergedWorktrees).toEqual([{ path: '/repo/.claude/worktrees/agent-1', branch: 'feat/merged', pr: 42 }]);
    expect(findings.staleOrConflicting).toEqual([{ number: 43, title: 'a pull request', reasons: ['mergeable is CONFLICTING'] }]);
    expect(findings.noChecksRegistered).toEqual([pr({ number: 43, headRefName: 'feat/open', state: 'OPEN', mergeable: 'CONFLICTING', statusCheckRollup: [] })]);
    expect(isEmpty(findings)).toBe(false);
    // The per-folder entry count comes from the same injected readDir,
    // called once for the worktrees directory and once per untracked folder.
    expect(readDirCalls.some((dir) => dir.endsWith('agent-leftover'))).toBe(true);
  });

  it('is clean — isEmpty is true — when nothing is found', async () => {
    const fakeGit: Run = async (args) => {
      if (args[0] === 'for-each-ref') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'worktree') return { status: 0, stdout: 'worktree /repo\nbranch refs/heads/develop\n', stderr: '' };
      return { status: 0, stdout: '0\n', stderr: '' };
    };
    const fakeGh: Run = async () => ({ status: 0, stdout: '[]', stderr: '' });
    const findings = await find({ gh: fakeGh, git: fakeGit, readDir: () => [], gitStatus: async () => false });
    expect(isEmpty(findings)).toBe(true);
  });
});

describe('gh / git', () => {
  it('reports a real failure, for an invocation that is safe offline', async () => {
    const ghResult = await gh(['pr', 'list', '--repo', 'no/such/repo-x', '--bogus-flag']);
    expect(ghResult.status).not.toBe(0);

    const gitResult = await git(['for-each-ref', '--bogus-flag']);
    expect(gitResult.status).not.toBe(0);
  });
});
