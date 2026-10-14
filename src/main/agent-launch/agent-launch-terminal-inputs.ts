import type { AgentLaunchIntent } from '../../shared/agent-launch-intent'

/** What every route that builds a terminal agent passes on, so the startup terminal of a new
 *  workspace and the terminal of an existing one start the same agent. */
export function terminalLaunchInputs(intent: AgentLaunchIntent) {
  return {
    ...(intent.sessionOptions ? { options: intent.sessionOptions } : {}),
    // `null` is a value the caller meant, so this tests for absence rather than falsiness.
    ...(intent.agentArgs !== undefined ? { agentArgs: intent.agentArgs } : {}),
    ...(intent.cwd ? { cwd: intent.cwd } : {}),
    ...(intent.launchSource ? { launchSource: intent.launchSource } : {}),
    ...(intent.paneKey ? { paneKey: intent.paneKey } : {})
  }
}
