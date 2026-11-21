# makefun-sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/shusay12/makefun-sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/shusay12/makefun-sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

<sub>Entered on [make.fun](https://make.fun/?ref=susay21&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>

---

# Sokoban Solver — push-optimal, room by room

A Sokoban solver that answers a whole set of 5 levels in one run, in as few
pushes as possible. `main.ts` is the entry point: Node 22 runs
`node /bot/main.ts`, reading `/input/<id>/level.txt` and writing
`/output/<id>/solution.txt` (moves in LURD) for each instance.

## How it works

Every generated level is a 1-wide hallway with 1–4 rooms off it, and a box
pushed out of a room into the hallway can never come back — so each room is
an independent sub-problem and the level optimum is the sum of the rooms'
optima. Each room is solved **push-optimally** with a breadth-first search
over pushes: a state is the boxes' squares plus the player's reachable
region (named by its lowest square). Two sound prunes keep the search small:

- **Dead squares** — a box that can never be pushed onto any goal, found by
  pulling boxes back from the goals.
- **Frozen 2×2 blocks** — walls/boxes with a box off its goal.

Work is budgeted by states expanded, never by the wall clock, so two runs
write the same bytes. Fallbacks, in order, if a room's BFS exhausts its
budget: push-A\* with a sum-of-min-distances heuristic, then a plain
move-A\* that at least produces a valid solution. Stdlib only, no network,
no clock, no installs.

## Practice results (kit's own scorer, `program/scorer/score.ts`)

| instance | pushes | P\* | points |
|----------|--------|-----|--------|
| i001 | 13 | 13 | 1,000 |
| i002 | 16 | 16 | 1,000 |
| i003 | 29 | 29 | 1,000 |
| i004 | 47 | 47 | 1,000 |
| i005 | 60 | 60 | 1,000 |

**Practice score: 1,000,000** (all five instances at exactly P\*), in ~1 s
for the whole set — well inside the 60 s wall. Two runs are byte-identical.
The house baseline (plain-astar 1.0.0) scores 200,000 on the same set
(only i001 solved). Two extra holdout sets drawn from the kit's own
generator with fresh seeds also scored 1,000,000 each, every instance at
exactly P\*.

Practice scores are not final results: the final ranking runs on a set
drawn from drand round 34200012 after the deadline.

## Running it locally

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=path/to/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Structure

- `main.ts` — the whole solver (entry point, Node 22, TypeScript erasable syntax)
- `LICENSE` — MIT

## License

MIT — see [LICENSE](LICENSE).
