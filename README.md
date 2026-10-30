# Coverage risk for Jira (MVP)

A read-only Jira panel that answers one question: how much of the team's work depends on one person, and what stops if they're out?

People are the nodes, and tickets are the evidence on the edges. Everything is derived from fields Jira already has. Nothing is entered by hand.

This MVP runs locally on mock data shaped like the Jira Cloud REST API. There is no Forge app yet.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build into dist/
npm run verify     # node checks: small fixture (stage 1–2) + large demo fixture (no install needed)
```

Requires Node 18+.

## Layout

| Path | What it is |
|---|---|
| `src/data/jiraMockLarge.js` | Default demo data: 4 teams of 3–4 people, plus edge cases. Checked by `npm run check:large` |
| `src/data/jiraMock.js` | Small test fixture (7 people). The stage 1–2 tests assert its exact values. Open the app with `?data=small` to see it |
| `src/data/jira-raw*.json` | Output of `npm run dump:raw`, for inspecting the Jira shape. Nothing reads these; edit the `.js` files instead |
| `src/analysis/adapter.js` | Jira REST → people, issues, dependencies, collapsed person edges, data-quality report |
| `src/analysis/coverage.js` | Coverage-risk scoring, chains, bridges, lead changes, unblock count, nearby candidates |
| `src/analysis/sentences.js` | Edge sentences and the ticket / theme / team zoom lines |
| `src/analysis/layout.js` | Graph geometry |
| `src/components/*` | Graph, ranking, detail, and ticket-key evidence |
| `scripts/stage1.js`, `scripts/stage2.js` | Node verification with assertions |

The `src/analysis` folder has no React imports and runs in plain node.

## Scoring

Coverage risk is scored as "if this person is also out":

| Points | Rule |
|---|---|
| 4 | Each open task left with no one doing work on it. Counted only if something waits on it. |
| +2 | That task is already Blocked or overdue. |
| 4 | Each distinct person left waiting. Chains are followed to the end, with a cycle guard. |
| 2 | Each team pair connected only through this person, on their side of the pair. |
| 2 | Each task that keeps going but changes lead. Lead is the assignee, or the reporter if there is no assignee. |

"Covered" means two or more people doing work on a task: the assignee, or an open sub-task assignee. Reporters don't count as coverage.

Staleness means no update in more than 14 days. It is a flag only and never adds to the score.

## Collaboration

"Works with" means two people on the same task: the assignee and the sub-task assignees. Reporters never count.

- Now: the task is open and both people are still on it.
- Before: the task or the sub-task is Done.
- It is display-only and never changes a score. Coverage already counts open sub-task assignees.
- The graph shows it as a green casing under a dependency arrow, or a green line when there is no dependency. A Both / Waits on / Works with switch picks the layers.
- When someone is marked out, work that keeps going because someone else is on it turns green ("continues").
- Limit: Jira has one assignee per issue, so collaboration only shows where teams use sub-tasks.

## Tunables

| Constant | File | Default | Effect |
|---|---|---|---|
| `ORPHAN_REQUIRES_DEPENDENT` | `coverage.js` | `true` | Set `false` to score every solo task. |
| `RED_ON_UPSTREAM_WAIT` | `adapter.js` | `false` | Set `true` to also turn edges red when the blocker is only waiting on another link. |
| `WEIGHTS` | `coverage.js` | as in the table above | Point values for each rule. |
