// Client-side tool results must be sent only while reply.done is the latest
// agent event: not earlier (the agent is mid transition phrase) and not after
// the user has started a new turn. Results for an interrupted reply are dropped.
// https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/client-side-tools

export class ToolResultQueue {
  constructor(send) {
    this.send = send
    this.pending = []
    this.last = null
  }

  // Record the lifecycle events that matter for timing.
  onEvent(msg) {
    if (msg.type === 'reply.started' || msg.type === 'input.speech.started') {
      this.last = msg.type
    } else if (msg.type === 'reply.done') {
      this.last = 'reply.done'
      if (msg.status === 'interrupted') {
        this.pending = []
        return
      }
      this.flush()
    }
  }

  add(callId, result, isError = false) {
    this.pending.push({
      type: 'tool.result',
      call_id: callId,
      result: typeof result === 'string' ? result : JSON.stringify(result),
      ...(isError ? { is_error: true } : {}),
    })
    this.flush()
  }

  flush() {
    if (this.last !== 'reply.done') return
    while (this.pending.length) this.send(this.pending.shift())
  }
}
