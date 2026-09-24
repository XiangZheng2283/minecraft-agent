# Optimization tests

The current work uses Sol as the planner and JEV as the controller. The user approved Sol as a substitute for Astra. JEV selects bounded actions. Mineflayer executes normal movement, mining, crafting, and interaction packets.

## Transcript findings

The prior complete recording (`recorded-06`) took 49 minutes. It included one death and equipment recovery. Its transcript had 785 decisions, 215 waits, 55 portal descent actions, and 78 planner calls. Planner calls can overlap game actions, so API time is not the same as added run time.

The development tests exposed these faults:

- A completed waypoint still offered movement with no useful distance.
- A navigation failure disabled movement for too long.
- The agent collected extra food, wood, and tools on Peaceful difficulty.
- It placed and recovered crafting tables after crafting was complete.
- Some resource actions mined from water and failed to collect the drop.
- The boat recovery action only dismounted. It could leave the boat behind.
- Boat choices did not state which directions had a clear path.
- The nearest dry bank could be behind the player or too high to reach by swimming.
- Using navigation blocks could change the stage from travel back to preparation.
- The direct route crossed a rocky shore where movement repeatedly failed.
- The portal descent action could mine air without moving the player down.
- Canceling a bridge move left a return target inside the pathfinder. Its movement loop then pulled the player toward this old target before it checked the new goal. In water, the target height could not be reached. New swim choices could not work.

## Evidence from failed actions

The repeated shore actions in `optimized-final-01` could not succeed because the pathfinder still controlled movement through an old return target. New model plans could not remove that target. In `optimized-final-02`, decision 171 escaped east from one breath cloud into another; decision 172 then returned through the first cloud. The new path check uses both clouds. In `optimized-final-03`, the repeated table approach reported success with no movement because the table was already within reach. A section-boundary search fault hid the crafting choices.

These failures required changes to action validity and execution. More detailed model instructions alone would not fix the stale movement target or missing crafting choices. The final policy gives the models current kit deficits, the next surveyed route point, measured water clearance, and checked escape paths.

## Changes

The harness now checks action results, filters completed supply work, and retains the completed preparation stage. It gives JEV measured water clearance and reachable bank choices. Boat recovery includes collection. Mining from water first looks for a dry standing position. Planner reviews use milestones, route progress, and failures. Recent observations omit repeated inventory copies.

The pathfinder patch clears the bridge return target on cancellation and stop. An epoch counter rejects a delayed placement callback after cancellation. Normal block updates retain the valid return target. Four regression checks use the installed pathfinder source. The parser, packet, policy, and cancellation checks pass.

The route survey reads terrain from earlier worlds with the same seed. It does not edit any world. The route follows long stretches of open water and avoids the failed rocky shore. Sol receives the next route point and the remaining route. JEV still chooses each action.

## Native renderer

The video uses the Minecraft Java 1.16.5 client with its normal models, textures, effects, and animations. A local protocol mirror supplies the bot's world, inventory, health, position, and actions. Viewer inputs do not reach the Survival server.

The display window is hidden. Window focus and mouse capture are disabled. Frame capture reads the game's frame buffer. It does not capture the desktop or use the user's mouse. The client is restricted to the local mirror. The video is silent.

The recorder uses fixed 960 × 540 frames at 20 fps. It waits for game resources before loading the mirrored world. A test exposed a frame-size change after startup. The recorder now scales every frame to its fixed input size. The corrected test produced 43.3 seconds and 866 frames. A boat-motion test produced 38.45 seconds and 769 frames.

## Test status

`optimization-01` is a development trial. It exposed navigation and renderer faults. It did not reach the dragon.

`optimization-02` is a component test. Its first recording has the old frame-size fault and is not a final video. The same Survival world completed the route and combat with the corrected harness. It killed the dragon, reached the exit portal, and finished with 20 health and no deaths. Six bed explosions killed the dragon. Saved-world checks pass in `runs/optimization-02/world-proof.json`. Source changes and restarts in these development trials are retained in the logs. The valid native combat clip is `native-client/end-fight-test.mp4`.

`optimized-final-01` reached the final shore in about nine minutes, then exposed the stale pathfinder return target. A runtime diagnostic confirmed that the old bridge target still controlled movement while the active goal was null. An attempted runtime repair caused a null-target error. The partial video and transcript remain as a failed development test.

`optimized-final-02` passed the shore and portal route with no runtime changes. It failed in the End: an escape from one breath cloud crossed another. The complete failed video is retained. The old escape checked only an adjacent obstruction. It did not check the whole path against every cloud.

The revised escape samples ground and head clearance along 16 directions. It rejects paths that enter a cloud which does not contain the starting point. It ranks the remaining paths by safe exit and exposure, then gives JEV three choices. Movement stops if blocked or a new cloud obstructs the route. Waiting stops as soon as breath approaches. The saved terrain and cloud state from the failure pass the replay check in `optimization/breath-replay.json`. All breath checks pass.

`optimized-final-03` was stopped during preparation. The short table search missed a table across two section edges. A longer search found the same table and offered a movement action that was already complete. The harness now uses one table search and tests its distance before crafting or movement. The logged boundary case has a regression check.

All 27 checks pass. `optimized-final-04` completed a fresh Survival/Peaceful run with these repairs installed. The native recording lasts 12 minutes 36 seconds. It contains 161 JEV decisions, 20 planner calls, six successful bed explosions, no deaths, and full health at completion. All 17 verification checks pass. Source and guidance hashes stayed unchanged. The full video decodes without errors. See `optimization/COMPARISON.md` for the measured comparison.

The final successful fight did not need a breath escape. The revised multi-cloud escape has regression and saved-terrain replay coverage; this success alone does not prove its behavior against every live dragon attack. Ten action failures remain in the transcript, including inventory retries and bounded movement timeouts. These limits are retained in the evidence.
