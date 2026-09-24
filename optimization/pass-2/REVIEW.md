# Second optimization pass

The review used the complete action transcript and video frame sequences. The overview samples the full 12m36s video at one-minute intervals. Closer sequences cover the 20-second bed delay and the End approach. The CSV contains every action and its time in the video.

## Findings and changes

- The boat used 61 straight rowing actions. Each action stopped after about 29 blocks even when more water was clear. Straight segments now check up to 96 blocks and can travel up to 92 blocks. Detours remain short. The speed cap, acceleration, buoyancy, and collision checks are unchanged.
- The planner was called at almost every route bend. Astra can now approve the surveyed route as one travel objective. The harness advances its known waypoints; stage changes, failures, and periodic checks still trigger a plan review.
- Two furnace checks had no output. Peaceful preparation no longer offers these checks.
- The End approach made a long path search, timed out after useful movement, and triggered a false failure review. It now uses short loaded segments and reports partial progress accurately.
- Manual resource digging could begin while a pathfinder goal remained active. The resource action now clears that goal before digging.
- A pending model request could leave extra idle footage after the exit event. Capture now ends from the completion event after five seconds, independent of that request. A late model response cannot start another action after victory.

Astra responded successfully through OpenRouter and passed a replay of the completed-kit travel state. The next full run uses Astra as planner and JEV as controller. The previous run used Sol, so the comparison is a system comparison and does not isolate model quality.

## Small scenarios

The live scenarios use a separate local server on port 25577 and a copy of the completed world. The boat lane, starting positions, and inventory are prepared test fixtures. They are not full Survival wins. The first fixture attempts failed because the lane extended beyond loaded chunks; those failures were excluded from the movement measurements.

The 100-block boat crossing used four JEV decisions and 17.973 seconds before the change. It used two decisions and 16.632 seconds after the change. Both use the same speed cap.

The End movement scenario compares the former long target with the revised short segments. The former action timed out after 15 seconds while still about 44 blocks from the fountain. The revised approach completed in 29.041 seconds over four successful segments. This is a completion check, not an isolated speed benchmark: the old action did not complete the route. The active exit portal was removed in this test copy so arrival would not end the scenario. Its measured results are in `scenario-results.json`. The policy and regression suite has 33 passing checks.

## Full-run gap and recovery scenario

`optimized-overlay-01` was stopped during preparation. It had five beds, but all remaining beds were beyond the 48-block observation range. The saved-world replay found eight remaining beds within 96 blocks. The harness now exposes short approaches to those observed beds. A live continuation from the stalled state collected all eight beds in eight decisions. This continuation is a recovery scenario, not a fresh full run. The boat departure point is also withheld until the kit is complete. See `bed-replay.json` and `bed-recovery-proof.json`.

## Video display

The new video adds a 120-pixel strip above the native 960 × 540 image. The complete output is 960 × 660 at 20 fps. It shows the actual planner name and objective, JEV's selected action, model-call latency, elapsed time, stage, supplies, and position. Text comes from timestamped responses and one-second state samples. It does not contain inferred model thoughts.

The raw native capture remains unchanged. The overlay has an explicit time mapping and manifest. The eight-second encoded test has 160 frames and passed its layout check. All work uses background processes and a hidden client.

## Full run

`optimized-overlay-02` completed from a fresh empty-inventory Survival/Peaceful world. Astra planned and JEV controlled the player. Five bed explosions killed the dragon. The agent reached the exit portal with 20 health and no deaths. All 17 native capture, transcript, source-hash, and saved-world checks pass. The native capture is 778.5 seconds (12m58.5s).

Planner calls fell from 20 to 8 and boat decisions from 62 to 34. Action failures fell from 10 to 4, with the partial-progress reporting caveat above. Total decisions rose from 161 to 167. The full video is 22.15 seconds longer than the previous video, and the exit event occurred 54.09 seconds later. This pass improved specific components, but did not improve total completion time.

Remaining costs are visible in the new transcript: preparation spans 238.2 seconds versus 179.0 seconds; navigation-block collection used 19 actions versus three; seven boat detours replaced one; and portal entry was selected 29 times, with 26 unchanged-position results. A later pass should suppress portal entry until the player can reach its height and measure preparation block use. The End approach completed without a path failure. The sources and guidance stayed fixed throughout this run. See `RESULT.md` and `comparison.json` for the measured comparison.

The final annotated video also passes all 17 checks. A full decode produced no errors. It contains 15,570 frames at 20 fps, 960 × 660, and is 60.1 MiB. The preparation, travel, bed-blast, and completion frames passed visual review in `final-video-qa.png`. The complete native viewport and HUD remain visible.
