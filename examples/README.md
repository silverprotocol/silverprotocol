# Examples

## `convergence-echo`

The same logical interaction — *call the `echo` tool with `"hi"`, then reply
`"Done."`* — captured from two different agent frameworks, plus the AgJSON each
one normalizes to. This is the core AgJSON thesis in data form: **different
native shapes, one event vocabulary.**

| File | What it is |
| --- | --- |
| `claude.native.json` | The interaction as the Claude Agent SDK emits it (fat `SDKMessage` objects). |
| `openai.native.json` | The same interaction as the OpenAI Agents SDK emits it (streamed `RunItemStreamEvent`s). |
| `claude.agjson.json` | The AgJSON event stream the Claude normalizer produces. |
| `openai.agjson.json` | The AgJSON event stream the OpenAI normalizer produces. |

The two `*.agjson.json` files differ only in provider-assigned ids and
per-framework turn boundaries — the **event vocabulary is identical**
(`turn.start` · `message.start` · `tool.start` · `tool.args.*` · `tool.done` ·
`text.*` · `message.end` · `turn.done`). A client written against those events
works with either framework.

These are synthetic conformance fixtures drawn from the reference SDK's test
corpus — safe to read, copy, and diff.
