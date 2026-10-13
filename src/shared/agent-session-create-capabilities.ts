// The capabilities that gate what an `agentSession.create` or `agentSession.send` may carry.

// Why: `agentSession.create` is a strict object, so an older host refuses a payload carrying the
// reserved `tabId` rather than ignoring it. A client sends the field only to a host advertising this.
export const AGENT_SESSION_CREATE_TAB_ID_RUNTIME_CAPABILITY =
  'agentSession.create.tab-id.v1' as const
// Why: same strict object; a host advertising this records the conversation's first message with
// the chat it creates, so the message is the host's from the start.
export const AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY =
  'agentSession.create.message.v1' as const

// Why: `agentSession.send` is a strict object, so an older host refuses `options`. A host advertising
// this applies a send's model and effort to the turn it starts and records them on the chat.
export const AGENT_SESSION_SEND_OPTIONS_RUNTIME_CAPABILITY =
  'agent-session.send-options.v1' as const

export const AGENT_SESSION_CREATE_RUNTIME_CAPABILITIES = [
  AGENT_SESSION_CREATE_TAB_ID_RUNTIME_CAPABILITY,
  AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY,
  AGENT_SESSION_SEND_OPTIONS_RUNTIME_CAPABILITY
] as const
