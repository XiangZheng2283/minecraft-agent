# Second-pass result

| Measure | Previous run | New run |
|---|---:|---:|
| Full video | 12m 36s | 12m 58s |
| Exit portal reached | 12m 03s | 12m 57s |
| JEV decisions | 161 | 167 |
| Planner calls | 20 | 8 |
| Boat decisions | 62 | 34 |
| Generic waits | 0 | 0 |
| Action failures | 10 | 4 |
| Deaths | 0 | 0 |

The previous planner was Sol. The new planner is Astra. JEV controls both runs. Both use Survival/Peaceful and the same seed. This compares two full systems and single runs, not model quality in isolation. Path searches that make useful progress are now reported as progress, so failure counts also reflect that change.

The new run is `optimized-overlay-02`. All gameplay was recorded from an empty inventory through the dragon kill and exit portal. Source and guidance hashes stayed unchanged during the run.

The full native capture is retained. The annotated video adds model objectives, selected actions, API latency, elapsed time, stage, supplies, and position in a strip above the complete game image. It has no audio.

See `REVIEW.md` for the transcript findings, isolated scenarios, and the failed preparation test that exposed the missing bed-search choice.
