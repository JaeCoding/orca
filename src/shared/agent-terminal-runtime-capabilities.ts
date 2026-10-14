export const AGENT_SESSION_HOST_AUTHORITY_RUNTIME_CAPABILITY =
  'agent-session.host-authority.v1' as const
// Older strict terminal-agent create schemas reject an unadvertised placement field.
export const AGENT_TERMINAL_FIRST_POSITION_RUNTIME_CAPABILITY =
  'terminal.agent-first-position.v1' as const

export const AGENT_SESSION_KEYBOARD_RUNTIME_CAPABILITY = 'agent-session.keyboard.v1' as const
export const AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY =
  'agent-session.omp-resume-path.v1' as const
export const AGENT_TERMINAL_RUNTIME_CAPABILITIES = [
  AGENT_SESSION_HOST_AUTHORITY_RUNTIME_CAPABILITY,
  AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY,
  AGENT_TERMINAL_FIRST_POSITION_RUNTIME_CAPABILITY,
  AGENT_SESSION_KEYBOARD_RUNTIME_CAPABILITY
] as const
