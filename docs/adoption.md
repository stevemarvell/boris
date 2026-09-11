# Stages of agentic adoption

[Boris Cherny](mailto:boris@anthropic.com) — Jul 16, 2026

---

## 0: Gated

**Agents:** 0

**What it looks like:** Only older or lighter/faster models are approved, latency compounds through AI gateways and custom auth, no MCP governance, internal access to AI tools is gated or process-heavy. No IT infra or approval path for hosting Claude-created code or artifacts; outputs only exist locally.

**What's the bottleneck:** Legacy security and approval processes, focuses on cost-per-token containment vs. outcomes, lack of true technical voices in decisionmaking.

**Products that help with each step:**

- Claude.ai chat

**Guardrails:**

- SSO/SCIM plus role-based access
- Org-level budget caps
- Deploy inside existing approvals/IAM
- Data governance package

> **How to get from step 0 to 1:** Executive/buyer alignment and escalation of blockers; frameworks for launching Claude securely

---

## 1: Assisted

*You + an agent (a pair)*

**Agents:** ~1

**What it looks like:** One engineer, one agent, mostly supervised—a fast pair programmer. You run one session at a time and review almost every change before it merges.

**Unlock:** A change that used to fill an afternoon becomes something you finish between meetings.

**What's the bottleneck:** Your attention and the need to inspect each response and code edit. Due to low trust for the model's output and lack of self-verification, you feel you must read everything, so you never look away. Work is synchronous: you sit and watch while Claude works, rather than moving on to the next task.

**Products that help with each step:**

- Claude Code in the Desktop, CLI, or IDE
- Claude Cowork, Claude Design
- Usage via Anthropic API, Bedrock, Vertex, or Microsoft Foundry
- Claude Code analytics dashboard + Analytics API
- Compliance API for Claude Enterprise
- Plan mode to review intent before edits

**Guardrails:**

- Per-seat spend caps
- Centrally managed model/effort settings
- Centrally managed policy
- [OpenTelemetry export](https://code.claude.com/docs/en/monitoring-usage) into existing SIEM/observability stack

> **How to get from step 1 to 2:** Run more than one agent at a time; a self-verification loop you trust (tests + build + lint + e2e testing with a real dev environment); auto mode, to avoid blocking permission prompts; automate code review

---

## 2: Parallel

*Orchestrator*

**Agents:** ~10

**What it looks like:** One engineer orchestrates 5–10 agents at once, each on its own worktree or git checkout, jumping between them. Claude checks its own work—tests, build, lint, security scan—before you see it. Auto mode is always on. Automated code review and security review are on by default. Output multiplies, you review final diffs rather than keystrokes, and your backlog of maintenance work starts shrinking. Claude writes most of the code.

**Unlock:** A backlog that used to take the team weeks becomes one engineer's afternoon of orchestration.

**What's the bottleneck:** Reviewing output. You're hand-writing less code and instead checking six streams of it, and this takes up more of your time. Prompting and steering the model as you juggle sessions.

**Products that help with each step:**

- [Auto mode](https://code.claude.com/docs/en/auto-mode-config)
- [Agent view](https://code.claude.com/docs/en/agent-view)
- [Claude Code Review](https://code.claude.com/docs/en/code-review)
- [Claude Security Review](https://claude.com/product/claude-security)
- Claude Code on Mobile, cloud execution in Desktop
- Usage via Claude Teams or Claude Enterprise
- Claude Tag (do a single task)
- Worktree isolation in CLI and Desktop
- [Remote control](https://code.claude.com/docs/en/remote-control), so you can monitor your agents from your phone

**Guardrails:**

- [Analytics](https://code.claude.com/docs/en/analytics) to monitor team usage
- Automatic code quality enforcement: lint, automated tests, typecheck
- Claude powered end-to-end verification (eg. using the [Claude Chrome extension](https://code.claude.com/docs/en/chrome) or iOS/Android simulator MCP)
- Manual code review, code merge, and security review. Hold the same quality bar for human and agent-generated code
- Pre-approve common safe bash and MCP commands in settings.json

> **How to get from step 2 to 3:** Give Claude a way to pull in context (let Claude read code, wikis, discussions); agency and code review speed (agents may touch code owned by other teams); break up your work into loops and routines; let Claude kick off Claude

---

## 3: Supervised autonomy

*Manager of managers (an org tree)*

**Agents:** ~100

**What it looks like:** Claude writes all or nearly all of the code. "Did you read the code?" becomes "what context was the model missing and how do we solve it for next time?"

**Unlock:** Claude proactively does work that you would have had to kick off manually before. Maintenance and cleanup that used to wait for someone to find the time now runs continuously in the background.

**What's the bottleneck:** Trust in the loop and your team's decision throughput. The agent tree is too deep to babysit and your trap is scaling agent count before the loop has earned widespread trust. Ensuring tokens are used efficiently as usage increases. Requires monitoring (via OTel or Analytics) and a culture that encourages experimentation while controlling costs once internal use cases find PMF. Ask yourself: is this something an engineer would have done?

**Products that help with each step:**

- Subagents with worktree isolation (so parallel agents don't collide)
- Routines, /loop, /batch, and /goal to fan out repetitive work
- [Dynamic workflows](https://code.claude.com/docs/en/workflows)
- Claude Tag (have it monitor a channel or data source and kick off tasks proactively)

**Guardrails:**

- Automatic code review
- Automatic security review
- [Agent sandboxing](https://github.com/anthropic-experimental/sandbox-runtime)
- CLAUDE.md and Skills to encode standards
- Tune [Auto mode](https://code.claude.com/docs/en/auto-mode-config) classifier based on your team's usage
- Manage [token use](https://code.claude.com/docs/en/costs#reduce-token-usage) with model selection, advisors, LSPs, breaking up CLAUDE.md into lazy Skills

> **How to get from step 3 to 4:** Scaled automation of domain-specific use cases (eg. code migration, fuzzing, feature-building, feedback remediation)

---

## 4: AI-native

*VP steering by intent*

**Agents:** ~1,000+

**What it looks like:** The loop is fully closed and most agents are kicked off by Claude. Hundreds to thousands of agents run; you steer by intent and monitor by exception.

**Unlock:** The quarter-long migration becomes a workflow you kick off and check on.

**What's the bottleneck:** Identifying and automating work at scale, and enforcing the right guardrails for each type of work.

**Products that help with each step:**

- Claude Agent SDK to programmatically build and schedule agents
- Claude Tag (active in most Slack channels, auto-responding to posts)

**Guardrails:**

- Cost controls for automation
- Model selection for automation
