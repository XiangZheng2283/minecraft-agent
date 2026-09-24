# Full-run comparison

| Measure | Earlier run | New run |
|---|---:|---:|
| Full video | 49 min 08 sec | 12 min 36 sec |
| JEV decisions | 785 | 161 |
| Planner calls | 78 | 20 |
| Generic waits | 215 | 0 |
| Failed actions | 54 | 10 |
| Deaths | 1 | 0 |

The baseline includes a death, recovery, and code-update pauses. The final run uses a native renderer, a surveyed route, and revised action policies. This is a whole-system comparison, not an isolated model benchmark.

The new recording uses Sol as planner and JEV as controller. It runs in Survival on Peaceful difficulty. The video uses native Minecraft Java 1.16.5 graphics at 960 × 540 and 20 fps. It has no audio.

New run: `runs/optimized-final-04`. Its saved world, model transcript, video duration, complete action coverage, and unchanged source hashes pass verification.

The main repairs remove completed supply tasks, avoid repeated waits, use measured boat clearance, follow a surveyed water route, and clear old pathfinder targets on cancellation. Planner calls occur at milestones and failures. Combat still uses normal player actions and a read-only dragon-position sensor.

Preparation still has inventory transaction retries. These retries remain in the full video and transcript. Further speed gains are possible; the result does not establish an optimal Minecraft time.
