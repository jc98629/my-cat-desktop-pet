# My Cat Pet × DeepSeek Harness

This local Cordis plugin listens only to the official DeepSeek Harness lifecycle
events needed by the desktop pet:

- `agent/status` and `turn/start` → `WORKING`
- `approval/asked` or an open `ask_user_question` / `exit_plan_mode` call → `WAITING`
- the matching decision or tool result → `WORKING`
- a successfully completed root turn → `DONE` for three seconds
- a root turn whose terminal reason is `error` → `ERROR`

It writes an atomic, minimal snapshot to
`~/.my-cat-pet/deepseek-state.json`. Prompt text, replies, tool arguments,
file contents, chat history, and credentials are never written.

The plugin tracks root agents only, so a sub-agent cannot overwrite the visible
state of the user's main DeepSeek task. File-write failures are contained and
never block or fail the Harness workflow.
