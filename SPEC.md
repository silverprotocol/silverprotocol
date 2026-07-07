# AgJSON v1 — Specification

> **Status:** Draft (2026-07-02) · **Spec version: `1.0.0-draft.1`** (the value `AgInputEnvelope.version` carries; negotiation rules in §12) · **License:** MIT (see `LICENSE`; applies to this specification text and the reference SDK). The open, neutral, typed format for **agent ↔ user-client** communication — input, output, and UI-interaction anchors. Home: `silverprotocol.io/AgJSON`. Normalizers (framework I/O ⇄ AgJSON) ship as `@silverprotocol/<framework>`.
>
> This revision streamlines AgJSON to a focused transport for normalized framework I/O: agent-UI output is carried via **MCP Apps + A2UI**. These two are the respected external UI/tool specs; AgJSON defines no component schema and no render layer of its own. A2UI is the first-class agent-UI-OUTPUT path: when an agent draws components by streaming, it emits A2UI, carried Layer-A-opaquely in AgJSON output (`resource` blocks for MCP Apps HTML surfaces + `ui.*` surface RPC + the `ui.surface.*` / `ui.data-model` surface-stream events for A2UI). Two general-purpose constructs (`state.snapshot`/`state.delta` and `hitl.ask.metadata`/`AgPausedAsk.metadata`) are anchored on LangGraph (`values`/`updates` stream modes; `interrupt(value: Any)`). This revision also **un-merges the surface-interaction layer**: the old single merged `AgUiAction` is replaced by a shared `AgSurfaceEnvelope` + five per-spec-faithful constructs (the `AgSurfaceInteraction` union), so each external UI spec's client→server message round-trips with its own field names instead of a lossy merge. It is still **Draft** — it may change before the v1 freeze.
>
> **Provenance:** designed from a deep cross-framework survey (Anthropic Messages API + Agent SDK, OpenAI Responses + Agents SDK, Google Gemini/ADK/A2A v0.3.0/A2UI v1.0, Vercel AI SDK v5/v6, LangChain/LangGraph v1, Pydantic AI v2, MCP + MCP Apps 2026-01-26) and adversarially gap-checked against primary sources. Rationale + per-framework mapping derive from an internal design record; a published rationale document accompanies the first public release.

## 0. Notation, naming system & invariants

AgJSON is a **neutral translation target**. It RECORDS what frameworks do; it never IMPOSES a framework's runtime model. Everything below follows from that.

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in BCP 14 [RFC 2119] [RFC 8174] when, and only when, they appear in all capitals, as shown here.

### 0.1 The opaque value

- **`unknown`** in this document means **"any JSON value" (opaque pass-through)** — implementations SHOULD type it as a recursive JSON value (`string | number | boolean | null | JsonValue[] | { [k:string]: JsonValue }`).
- **Never `any`.** Never `Record<string, unknown>` for **shaped** data — if a value has a known shape, it gets a named type. `unknown` is reserved for genuinely opaque pass-through (provider blobs, shared state, free-form tool I/O). The **sole** sanctioned use of `Record<string, unknown>` is the genuinely string-keyed map of opaque values — the A2UI `action.context` resolved data-bindings (`AgA2uiSurfaceAction.context`, §3): the MAP shape is known (string keys), each VALUE is opaque per §0.1, so `Record<string, unknown>` is the correct type THERE and only there.

### 0.2 Layer

- **AgJSON is Layer-A: it carries content + interaction anchors. Rendering is Layer-B.** The two respected external UI/tool specs are **MCP (MCP Apps)** and **A2UI v1.0**; AgJSON defines **ZERO** component schema and **ZERO** render layer — it RESPECTS A2UI and MCP, never reinvents them. (`ggui` / OpenAI Apps are additional Layer-B consumers; the sanctioned-spec language names MCP + A2UI.)
- **Clients MUST ignore unknown event types and unknown object fields.** This single rule makes the format forward-compatible. This is the **consumer-ingestion posture**: a consumer validating incoming events MUST parse-known-else-skip and pass unknown fields through untouched. **Producer conformance** is the stricter posture: an emitter validates its own output against the full schema and MUST NOT emit types or fields outside this spec except via `ext.<vendor>.<key>` / `_meta` / `providerMetadata` (§12). The two postures are distinct; applying producer-strict validation at a consumer boundary violates this rule and breaks §12's additive-minor versioning.

### 0.3 The EVENT-vs-BLOCK dot rule (load-bearing)

Every wire `type` discriminant is **self-identifying** by one rule:

> **A wire `type` containing a DOT is a streaming EVENT** — shaped `namespace(.sub)*.lifecycle` (one or more namespace segments followed by a lifecycle final), where the **final dot-segment** is an action/lifecycle word drawn from the closed set: `start | delta | end | done | call | result | ask | error | abort | blocked | required | snapshot | metadata | block | capabilities | action-result | update | remove | write` (the core lifecycle words) plus a small fixed tail of payload-naming finals — `assembled` (the reassembled tool-args), `opaque` (the verifiable reasoning blob), `context` (host hint), `display-mode` (surface display request), and `data-model` (the A2UI surface data-model push). `remove` (message deletion), `write` (memory side-channel) — added 2026-06-23 pre-freeze.
>
> **A wire `type` with NO dot (a bare lowercase-kebab noun) is a content BLOCK.**

So `type` alone tells you whether you are looking at a stream event or a persisted content block — no context required.

The shape admits multi-segment events: `tool.args.delta` and `tool.args.assembled` have three dot-segments (`namespace=tool`, intermediate `args`, final `delta`/`assembled`). The mechanical check is always against the FINAL segment; the intermediate `args` sub-segment is permitted by the `namespace(.sub)*.lifecycle` form above. The A2UI surface events `ui.surface.start` / `ui.surface.update` / `ui.surface.end` are likewise three-segment (`namespace=ui`, intermediate `surface`, final `start`/`update`/`end`); the OpenAI widget reply `ui.widget.result` is three-segment (`namespace=ui`, intermediate `widget`, final `result` — `result` is in the closed set); `ui.data-model` is two-segment with the payload-naming final `data-model`.

This resolves the historical `tool.result` collision cleanly:

- The **BLOCK** is `tool-result` (dotless noun — a persisted content unit).
- The finalizing **EVENT** is `tool.done` (dotted — it carries the tool-result onto the wire).

`content.block` is the canonical "emit one whole, non-streamed block" event: its final segment `block` is a noun, yet it is a dotted EVENT (it transports a BLOCK). It is the only event whose final segment names a content unit, and `block` is fixed in the closed set above precisely so the rule stays mechanical.

`message.start` / `message.end` are dotted lifecycle events (the message-partition openers/sealer, §4). They open and seal an `AgMessage` boundary in the stream; they do not themselves carry a content block.

**Three bare-noun EVENTs are an enumerated carve-out**, NOT blocks: `error` (the non-terminal advisory — deliberately bare to distinguish it from terminal `turn.error`), `source` (a grounding source), and `handoff` (an agent-to-agent edge). These three single-word event names are fixed by this spec; no other dotless `type` is an event. The mechanical rule for a reader is therefore: **dotted ⇒ event; dotless ⇒ block UNLESS it is one of `error` / `source` / `handoff`.**

**`ext.<vendor>.<key>` is the SOLE exemption from the closed-set final-segment rule.** A namespaced vendor-extension event (§12) is identified by its `ext.` prefix, and its FINAL dot-segment is **vendor-defined** — NOT drawn from the closed lifecycle/payload set above. The `ext.` prefix alone marks it as an event; the closed-set check does not apply to its final segment. No other dotted `type` may carry an open final segment.

### 0.4 Casing rules

- **Wire `type` discriminants:** dotted-lowercase; kebab-case **inside** a segment (`tool-result`, `resource-link`, `code-result`, `args.assembled`, `action-result`, `data-model`). **Never** snake_case, **never** camelCase segments.
- **`kind` discriminant VALUES** (the `AgInput.kind` union and the `AgBlock`/`hitl.ask` kind enums) are likewise dotless-kebab / bare-noun: `start | resume | tool-result` (input), never snake_case. The snake_case ban covers `kind` values, not only `type` discriminants. The surface-interaction discriminant VALUES (`AgSurfaceEnvelope.surface`: `a2ui | mcp-app | openai-app`) are likewise dotless-kebab and **singular**; the inner A2UI discriminant `a2uiMessage` (`action | function-response | error`) is dotless-kebab.
- **Object FIELD names:** `camelCase`. This rule governs **wire / serialized fields only.**
- **MCP-frozen externals are kept VERBATIM** and carved out here (they are someone else's frozen surface, not ours): **`_meta`**, **`mimeType`**, **`mediaType`**, **`content`**, **`structuredContent`**, **`isError`**, the MCP JSON-RPC **`method`** values (e.g. `ui/update-model-context`, `ui/message`, `ui/request-display-mode`, `ui/open-link`), and the MCP content-block **`annotations`** object (`audience`/`priority`/`lastModified`). These names appear exactly as MCP/Anthropic spell them and are the only permitted deviations from camelCase. (A2UI-frozen field names — e.g. `dataModel`, `surfaceId`, `catalogId`, `sourceComponentId`, `functionCallId`, and the OpenAI Apps SDK method names `setWidgetState`/`callTool`/`sendFollowUpMessage`/`requestDisplayMode` — are likewise kept as A2UI / the OpenAI Apps SDK spell them where they cross the wire.)
- **`__brand`** (on `AgProviderMeta`, §2) is a **compile-time-only phantom nominal marker** — it is never serialized and never appears on the wire, so it is exempt from the camelCase rule (which governs wire fields only).
- **Namespacing of `_meta` / `AgMeta` keys is a RECOMMENDED convention, not a wire-type constraint** (see §2 `AgMeta`): keys MAY be flat (bare names like `timestamp`, the reserved OpenTelemetry `traceparent`/`tracestate`/`baggage`, or a framework's flat metadata keys). The slash-prefixed form stays the convention for host-owned annotations.

### 0.5 Identity naming (see §1)

- An entity's **own** id is `id` (or a typed own-id where the entity has a dedicated channel: `turnId`, `toolCallId`, `askId`, `artifactId`, `sourceId`).
- A **cross-reference** to another entity is `<entity>Id` (`messageId`, `toolCallId` used as a reference, `agentId`).
- **`turnId` is dual-use** — a turn's **own id** (on `turn.start` / `subagent.start`), AND the **owning-turn cross-ref** any nested entity/event (step, message, ask, artifact, source, every event) uses to name its owning turn (exactly like `toolCallId`: an own-id on a call, a cross-ref on a result). `parentTurnId` is the **distinct** cross-ref a turn uses to name its **PARENT** turn (subagent nesting). The only prohibition is on a turn storing its **own** id under `parentTurnId`. The **root** is always `threadId`.
- `extensions?: string[]` on an entity carries **foreign** active-extension URIs (A2A), distinct from AgJSON's own `ext.<vendor>.<key>` event namespace (§12).

### 0.6 One word per concept

`turn` (the exchange) · `step` (one loop iteration) · `block` (a content unit) · `tool-call` / `tool-result` · `reasoning` (never "thinking") · `hitl` (the human-in-the-loop family) · `ask`/`answer` (the HITL request/response — `ask` materializes as the `hitl.ask` event, `answer` materializes as the `AgHitlAnswer` resume payload; there is **no** `hitl.answer` wire type) · `opaque` (provider-bound verifiable blob) · `paused` (a within-run wait — the word `interrupt` is purged everywhere, including async-tool scheduling, which uses `preempt`) · `surface` (an A2UI / MCP-Apps / OpenAI-Apps live render target) · `surface-interaction` (a client→server surface message — `AgSurfaceInteraction`, the un-merged successor of the old `AgUiAction`, a DIFFERENT axis from the `hitl` pause). Type names are `Ag<Noun>` PascalCase.

### 0.7 Three artifacts

- **`AgInput`** — the **input** envelope (a discriminated union on `kind`; §3).
- **`AgEvent`** — the streaming **event** unit (§4).
- **`AgMessage`** — the persisted **message object** (role + content record; §1, §3.2). The event stream folds into an `AgReduceResult` (messages + artifacts + state + turn records) via the normative `reduce()` (§5).

The triad reads: **AgInput in / AgEvent stream / AgMessage object.**

## 1. Identity & hierarchy — the backbone

AgJSON state is a strict containment tree. Every unit is both **placeable** in the tree and **directly addressable** for persistence and reconnect.

### 1.1 The containment tree

```
thread (conversation)
 └─ turn (exchange)
     └─ step (one loop iteration)
         └─ message
             ├─ block        (text · image · reasoning · …)
             └─ tool-call
```

A **`subagent` is a NESTED turn** — it is a full `turn` with its own `turnId` and a `parentTurnId` pointing at the enclosing turn. There is no separate "subagent entity": nesting reuses the turn machinery. A subagent's events interleave with the parent's in ascending `seq` within their invoke (INV-SEQ, §5.0); every event self-identifies its owning turn via its `turnId` (§4 base), so a reducer routes each block to the correct turn's open message regardless of interleaving (§5).

### 1.2 The triple-id rule

Every entity carries **three** locating ids:

1. **Its own id** — so it is directly addressable.
2. **Its immediate parent's id** — so it is placeable in the tree.
3. **The root `threadId`** — so it can be persisted / reconnected **without walking the chain**.

The root `threadId` on every entity is what makes the format addressable for a key-value persistence layer (you can write any unit knowing only its own id, its parent, and the partition root). This is exactly what `reduce()` (§5) reconstructs, and it maps 1:1 to guuey's DynamoDB `ThreadMessage` table (partition key = `threadId`).

### 1.3 Per-entity id-field table

The "owning turn (cross-ref)" column is the `turnId` cross-reference an entity uses to name its owning turn — **not** a parent-in-the-tree link except for `turn` itself, whose upward link is `parentTurnId`.

| Entity        | Own id        | Owning turn (cross-ref) | Root        | Notes                                                            |
| ------------- | ------------- | ----------------------- | ----------- | --------------------------------------------------------------- |
| `thread`      | `threadId`    | —                       | (self)      | The conversation root.                                           |
| `turn`        | `turnId`      | `parentTurnId` (parent) | `threadId`  | `parentTurnId` present ⟺ this turn is a subagent (its UPWARD link). |
| `step`        | `id`          | `turnId`                | `threadId`  | One loop iteration inside a turn.                                |
| `message`     | `id`          | `turnId`                | `threadId`  | The role + content record (`AgMessage`). Opened by `message.start`. |
| `block`       | `id`          | `messageId`             | `threadId`  | A content unit inside a message; binds to the most-recently-opened message of its turn **and `candidateIndex`** (absent ⇒ 0) (§5). |
| `tool-call`   | `toolCallId`  | `messageId`             | `threadId`  | Cross-referenced by `tool-result.toolCallId`; binds to the most-recent open message of its turn **and `candidateIndex`** (absent ⇒ 0). |
| `tool-result` | `toolCallId`  | `messageId`             | `threadId`  | Same `toolCallId` binds result to its call (not its own id); `tool.done.messageId` is the result message's own id; `tool.done.candidateIndex` absent ⇒ 0. |
| `ask` (HITL)  | `askId`       | `turnId`                | `threadId`  | May reference a `toolCallId`.                                    |
| `artifact`    | `artifactId`  | `turnId`                | `threadId`  | A side-channel landing zone (NOT an `AgBlock`; `AgArtifact`, §2/§5). |
| `source`      | `sourceId`    | `turnId`                | `threadId`  | Grounding source.                                                |

A **`surface` (A2UI / MCP-Apps / OpenAI-Apps render target) is deliberately NOT in this table.** A `surfaceId` names a LIVE render-side address, not a persisted containment-tree entity; surfaces are ephemeral and never folded into `AgReduceResult` (see §4 / §5 / §6 Pattern 1b). There is no surface row precisely because surfaces are live-only. The surface-interaction envelope (`AgSurfaceEnvelope`, §3) nonetheless keeps `surfaceId` / `toolCallId` / `turnId` / `threadId` at the AgJSON layer so a client→server surface message stays addressable (correlatable to its producing tool-call and owning turn) even though no surface row is ever persisted.

`referenceTurnIds` (input-only, optional) carries cross-turn references (e.g. "regenerate from these prior turns") and is **not** a parent link.

## 2. Content blocks — the shared spine

`AgBlock` is the full object-form union (dotless-kebab `type` discriminants, per §0.3). The **same union appears in both directions** — input messages, output content, and `tool-result.content` — so input == output minus the streaming envelope (§3.2).

```ts
type AgSource =
  | { type: "base64"; mediaType: string; data: string }   // mediaType REQUIRED; must match bytes
  | { type: "url";    url: string; mediaType?: string }
  | { type: "file";   fileId: string; mediaType?: string };
// MCP image/audio are base64-only {data,mimeType}; url/file are the Anthropic/Gemini superset.
// A wrong merge silently drops url/file — conformance-tested both ways.

// Grounding-source payload union (§4 `source` event) — reused verbatim by
// AgTurnRecord.sources[] (audit M23) so the two never drift.
type AgSourcePayload =
  | AgSource
  | { url: string; title?: string }
  | { type: "document"; mediaType?: string; title?: string; filename?: string };

// Host-only side metadata (MCP _meta): keys are FLAT-or-namespaced.
// Namespacing (dotted-prefix + slash, e.g. "acme.tracing/spanId") is a RECOMMENDED convention
// for HOST-OWNED annotations, NOT a wire-type constraint. Bare keys are permitted: the MCP key
// grammar (optional dotted prefix + slash OR a bare name), the reserved OpenTelemetry keys
// traceparent/tracestate/baggage, and flat framework metadata (A2A free-form, Vercel createdAt/
// totalTokens, Apps SDK component _meta) all round-trip unchanged.
type AgMeta = Record<string, unknown>;
// RECOMMENDED validator (SHOULD, not a type-level MUST):
//   /^([a-z0-9.-]+\/)?[A-Za-z0-9_.-]+$/  matches the MCP grammar (optional dotted prefix + slash,
//   or a bare name); traceparent | tracestate | baggage are additionally reserved-bare.
//
// RESERVED CONVENTION — transcription marker (A2-additive):
//   _meta["agjson/transcription"] = { role: "input" | "output", kind: "transcription" }
//   Marks a block or message as a transcription artifact (STT input / TTS output).
//   AgRole has no "input"/"output" values, so this annotation lives in `_meta` rather than
//   the block's `role`. It is a CONVENTION only — no schema arm change is needed.

// Replay-load-bearing provider metadata (OpenAI itemId etc.).
// Branded nominally distinct from AgMeta: a value that round-trips to the provider
// must NOT be confused with host-only annotations. The provider-replay channel imposes NO key
// namespacing — keys (flat or otherwise) echo VERBATIM (Pydantic provider_details, OpenAI itemId).
type AgProviderMeta = AgMeta & { readonly __brand: "AgProviderMeta" };

// Opaque provider-bound reasoning blob (signatures / encrypted / redacted reasoning),
// echoed back byte-identical or multi-turn reasoning breaks (hard 400 on Anthropic/Gemini).
// "ciphertext" carries an encrypted CoT / encrypted_content; "encrypted" is an accepted alias.
type AgOpaque = { kind: "signature" | "ciphertext" | "encrypted" | "redacted"; value: string; provider?: string };

// MCP content-block annotations (MCP-frozen verbatim — see §0.4). Routing/display hint:
// audience distinguishes model("assistant") vs end-user("user") blocks; priority orders display.
// Carried through reduce() UNCHANGED.
type AgAnnotations = { audience?: ("user" | "assistant")[]; priority?: number; lastModified?: string };

type AgBlock =
  | { type: "text"; text: string; citations?: AgCitation[]; providerMetadata?: AgProviderMeta; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "image"; source: AgSource; providerMetadata?: AgProviderMeta; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "audio"; source: AgSource; providerMetadata?: AgProviderMeta; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "file";  source: AgSource; filename?: string; providerMetadata?: AgProviderMeta; annotations?: AgAnnotations; _meta?: AgMeta }   // video = mediaType video/*
  | { type: "document"; source: AgSource; title?: string; providerMetadata?: AgProviderMeta; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "resource"; resource: AgEmbeddedResource; annotations?: AgAnnotations; _meta?: AgMeta }       // ui:// surfaces ride here
  | { type: "resource-link"; uri: string; mimeType?: string; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "code"; language: string; code: string; annotations?: AgAnnotations; _meta?: AgMeta }            // was executable_code
  | { type: "code-result"; outcome: "ok"|"failed"|"deadline_exceeded"; output: string; annotations?: AgAnnotations; _meta?: AgMeta }  // was code_execution_result
  // ONE reasoning block. Visible text + an optional opaque provider-bound part.
  // UNIFIES the old thinking / redacted_thinking / reasoning_state into one block.
  // opaque/providerMetadata/itemId are REPLAY-LOAD-BEARING — like tool-call.signature, they MUST
  // round-trip byte-identical on re-input (Gemini thoughtSignature on thought / built-in-tool steps:
  // echo or 400; OpenAI rs_ reasoning item id; Anthropic signature/redacted blobs ride the reasoning block's `opaque` carrier — `kind:"signature"|"redacted"`). A reasoning block
  // in AgMessage.content is re-emitted to the provider VERBATIM including opaque/providerMetadata.
  | { type: "reasoning"; text?: string; opaque?: AgOpaque; provider?: string;
      providerMetadata?: AgProviderMeta;       // authoritative lossless vendor bag (OpenAI itemId, …; NOT the Anthropic reasoning signature — that rides the block's `opaque` carrier)
      providerDetails?: unknown;                  // CONVENIENCE ALIAS — flat provider-keyed replay dict, echoed verbatim (Pydantic provider_details); NOT the only home (any part's provider_details maps to that block's providerMetadata, see §2 note below)
      itemId?: string;                            // OpenAI Responses reasoning item id (rs_…), echoed for stateless re-input
      annotations?: AgAnnotations; _meta?: AgMeta }
  // A provider-bound conversation summary (Pydantic CompactionPart). Visible-text + opaque-blob,
  // mirrors reasoning. Persisted-and-replayed: MUST be re-sent to the same provider on later turns.
  | { type: "compaction"; text?: string; opaque?: AgOpaque; provider?: string; annotations?: AgAnnotations; _meta?: AgMeta }
  // A grounding/search result carrying an opaque per-result replay blob (Anthropic web_search_result
  // encrypted_content — "must be passed back in multi-turn conversations"). opaque.kind:"ciphertext".
  | { type: "search-result"; url?: string; title?: string; opaque?: AgOpaque; pageAge?: string; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "tool-call"; toolCallId: string; name: string; input: unknown;        // was tool_use
      serverName?: string; providerExecuted?: boolean;
      signature?: string; provider?: string;          // Gemini thoughtSignature rides the tool-call — echo or 400
      title?: string;                                  // provider/model-supplied tool title (Vercel)
      toolMetadata?: AgMeta;                        // per-tool metadata bag (Vercel)
      itemId?: string;                                 // OpenAI Responses fc_ item id (echoes the input item array); DISTINCT from toolCallId (=call_id)
      providerCallIndex?: number;                      // Gemini null-id parallel-call positional index — replay-load-bearing (§8)
      uiVisibility?: ("model"|"app")[];                // MCP Apps access-control scope (from the tool's _meta.ui.visibility); model=model-callable, app=app-only
      providerMetadata?: AgProviderMeta; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "tool-result"; toolCallId: string; content: AgBlock[];             // was tool_result
      outcome?: "ok"|"error"|"denied"|"input_required";  // denied is its own outcome (NOT a derived isError alias); input_required = MCP MRTR pause disposition
      structuredContent?: unknown;   // MCP — MODEL-FACING structured result (always reaches the model; §2.1)
      uiData?: unknown;              // surface/view, MODEL-HIDDEN (MCP Apps structuredContent / OpenAI Apps component data; §2.1)
      sideData?: unknown;            // app-only side data (NEVER model, NEVER UI) — renamed from "artifact" (§2.1)
      errorText?: string;            // free-form error message (Vercel tool-output-error); present iff outcome==="error"
      errorCode?: string;            // structured server-tool error code (Anthropic web_search_tool_result_error.error_code)
      providerMetadata?: AgProviderMeta;  // provider-side tool-result metadata (Vercel)
      toolMetadata?: AgMeta; dynamic?: boolean;     // Vercel tool-output toolMetadata + dynamic-vs-static distinction
      pendingInput?: { requestState?: string; inputKeys?: string[] };  // MCP MRTR carrier when outcome==="input_required"
      preliminary?: boolean;         // set when the result is partial/kept-open (tool.done.more:true); cleared by the final tool.done (§2.2, §5; audit M20)
      isError?: boolean;             // MCP-frozen field, kept verbatim (derived: outcome==="error")
      annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "data"; name: string; id?: string; data: unknown; transient?: boolean; annotations?: AgAnnotations; _meta?: AgMeta }
  | { type: "provider-raw"; vendor: string; raw: unknown; annotations?: AgAnnotations; _meta?: AgMeta };  // lossless LAST-resort escape hatch

interface AgEmbeddedResource { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: AgMeta }
// UI surface convention: uri="ui://…", mimeType "text/html;profile=mcp-app",
//   _meta.ui = { resourceUri, csp?, permissions?, domain?, prefersBorder? }  (MCP Apps 2026-01-26 base fields);
//   plus widgetState? — an OpenAI Apps SDK field on _meta.ui (setWidgetState), OpenAI-Apps ONLY, NOT an
//   MCP-Apps concept (§6 Pattern 5, F3).
// NOTE: the resource block is the MCP Apps STATIC-HTML surface path ONLY. A2UI declarative-component
//   surfaces are NOT routed through this text/html resource block — they ride ui.surface.* / ui.data-model
//   (§4, §6 Pattern 1b), carried Layer-A-opaquely.
// NOTE: tool VISIBILITY is an ACCESS-CONTROL scope and lives on the TOOL, not the resource —
//   it moved to AgToolDef.uiVisibility / tool-call.uiVisibility (§3, §2). It is NOT a render convention.

// The A2A streamed-artifact ENTITY (the ONLY meaning of the word "artifact" — F11). Side-channel,
// NOT an AgBlock. reduce() lands these in AgReduceResult.artifacts (§5).
interface AgArtifact {
  artifactId: string; turnId: string; threadId: string;
  name?: string; description?: string;
  parts: AgBlock[];
  extensions?: string[];     // foreign A2A active-extension URIs (§0.5)
  _meta?: AgMeta;
}

// A folded memory write (§5) — the landing record for memory.write events, parallel to AgArtifact.
// Side-channel; NOT an AgBlock. scope="thread" records are bound to threadId and REPLACED by a
// messages.snapshot (§5). scope="agent"/"user"/"skill" are a SEPARATE cross-thread persistence axis
// (durable, NOT bound by the §1.1 thread containment tree) and are untouched by a per-thread snapshot
// (CRITICAL #3: a blanket REPLACE would let one thread's snapshot clobber cross-thread memory it has
// no authority over). The absent key targets the scope-default record (scope, "").
interface AgMemoryRecord {
  scope: "agent" | "user" | "skill" | "thread";
  key?: string;              // absent ⇒ scope-default record (scope, "")
  value: unknown;            // required on the LANDED record (the fold seeds it); JsonValue
  reason?: string;
  durable?: boolean;         // true = cross-thread persistence
  turnId?: string;
  threadId?: string;
}

// Per-turn folded record (paused asks, prompt.blocked safety, handoffs, sources, lifecycle state).
// Part of AgReduceResult; restorable on snapshot resync (§5/§4 messages.snapshot).
interface AgTurnRecord {
  turnId: string; parentTurnId?: string; threadId: string;
  outcome?: AgOutcome; finishReason?: AgFinishReason; usage?: AgUsage;
  safety?: AgSafety[];
  handoffs?: Array<{ kind?: "transfer"|"escalate"; fromAgentId?: string; toAgentId?: string; toAgentName?: string }>;
  sourceIds?: string[];
  sources?: Array<{ sourceId: string; source: AgSourcePayload; chunkIndex?: number; providerMetadata?: AgProviderMeta }>;  // FULL grounding-source records (audit M23); sourceIds[] stays as the derived binding index
  promptBlocked?: { reason: "safety"|"blocklist"|"prohibited"|"other"; safety?: AgSafety[] };  // audit M28 — the REQUIRED reason + blockedness itself, not just safety[]
  asks?: AgPausedAsk[];
  taskState?: string;        // verbatim A2A TaskState (NEVER reducer-invented — audit M29) for states that don't map to an outcome (submitted/rejected/auth-required-at-rest/unknown) — A44
  displayRequired?: Array<{ provider: string; html: string }>;  // ToS-must-render records (§4 display.required)
  trigger?: AgTrigger;       // what triggered this turn (A2-additive; folded from turn.start.trigger)
  guardrails?: Array<{       // guardrail evaluations folded from guardrail.result events on this turn
    target: "input" | "output" | "tool";
    passed: boolean;
    action?: "block" | "retry" | "rewrite" | "override" | "terminate";
    reason?: string;
    guardrailName?: string;
    safety?: AgSafety[];
  }>;
  capabilities?: AgCapabilities;  // agent's capabilities folded from agent.capabilities event (first-turn negotiation; §5)
}

// reduce() landing container — the well-typed return of the §5 fold (replaces "object == AgMessage").
interface AgReduceResult {
  messages: AgMessage[];
  artifacts: AgArtifact[];
  memory: AgMemoryRecord[];  // memory side-channel landing records (parallel to artifacts; required)
  turns: AgTurnRecord[];
  state?: unknown;           // shared-state working copy
}

// Citation: typed location union; index FRAME + UNIT explicit (Gemini grounding = UTF-8 BYTE offsets).
type AgCitation = {
  citedText: string; source?: string; title?: string;
  confidence?: number | number[];       // single, or per-support array (Gemini groundingSupport confidenceScores)
  confidenceScores?: number[];          // explicit per-chunk array alias (Gemini)
  encryptedIndex?: string;              // Anthropic web_search_result_location encrypted_index — MUST round-trip multi-turn
  indexFrame?: "source" | "response";   // Anthropic char/page/block = source; OpenAI/Gemini url/offset = response
} & (
  | { kind: "char";   documentIndex: number; startCharIndex: number; endCharIndex: number; unit?: "char"|"byte"|"utf16"; bounds?: "[start,end)"|"[start,end]" }
  | { kind: "page";   documentIndex: number; startPage: number; endPage: number }
  | { kind: "block";  documentIndex: number; startBlockIndex: number; endBlockIndex: number }
  | { kind: "url";    url: string; startIndex?: number; endIndex?: number; unit?: "char"|"byte"|"utf16"; bounds?: "[start,end)"|"[start,end]" }
  | { kind: "offset"; startIndex: number; endIndex: number; sourceIds: string[]; partIndex?: number; unit: "char"|"byte"|"utf16"; bounds: "[start,end)"|"[start,end]" }
);
```

> **Code-language round-trip note.** Gemini `ExecutableCode.language` is a closed enum (`LANGUAGE_UNSPECIFIED | PYTHON`); AgJSON's `code.language` is a free string. Round-trip OUT is lossy-safe, but a normalizer emitting a Gemini `executableCode` part MUST map an unknown `code.language` defensively (don't emit a provider-rejected language). No schema change.

> **Pydantic `provider_details` on ALL part kinds (clarification, no schema change).** A Pydantic part's `provider_details` is not exclusive to the thinking part: a part of ANY kind (text / tool-call / compaction / thinking) maps onto **that block's** `providerMetadata` (`AgProviderMeta`) verbatim. The `providerDetails?` field on the `reasoning` block is a **convenience alias** for the flat provider-keyed replay dict, **not** the only home for `provider_details`. This closes the latent gap where non-reasoning parts carry `provider_details`.

### 2.1 Tool-result channels (4, one consumer each)

A `tool-result` routes its payload over **four** channels, each with **exactly one** consumer. The channel **encodes** the audience — there is **no audience flag**.

| Channel             | Field                         | Reaches                          | Maps from                                                                |
| ------------------- | ----------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `content`           | `content: AgBlock[]`       | **model**                        | every framework's model-readable result.                                 |
| `structuredContent` | `structuredContent?: unknown` | **model** (always)               | base-MCP `structuredContent` (outputSchema), OpenAI Apps `structuredContent`. |
| `uiData`            | `uiData?: unknown`            | **surface/view, model-hidden**   | **MCP Apps `structuredContent`** (view-only / "not added to model context"), OpenAI Apps component-only `_meta` data. |
| `sideData`          | `sideData?: unknown`          | **app-only** (not model, not render) | LangChain `ToolMessage.artifact`.                                    |

> **Routing note.** `content` and `structuredContent` both reach the **model** (the latter is the typed/structured form — base MCP + OpenAI Apps are model-facing, and `structuredContent` keeps its exact base-MCP typing). `uiData` is the model-HIDDEN surface/view channel: MCP Apps' own `structuredContent` is view-only ("not added to model context") and routes here, as does OpenAI Apps component-only `_meta` hydration data. `sideData` (renamed from the old `artifact` channel) is strictly app-only. The word `artifact` is now reserved exclusively for the A2A **streamed entity** (`artifact.*` events + `AgArtifact`, §2/§4); it is no longer a tool-result channel.

> **`_meta` is not a result channel.** `_meta` (`AgMeta`) carries host/protocol annotations (timestamps, tracing) — NOT component data and NOT a result channel. OpenAI Apps component-only `_meta` (model-hidden hydration data) routes to `uiData`, not `_meta`.

> **Neutral structuredContent carrier (host convention).** Frameworks without a native structured channel populate it by host convention — e.g. the OpenAI Agents SDK surfaces no native `structuredContent`; a host wanting the channel returns `{ structuredContent: X }` as the run-item wrapper's tool output, and the facet extracts it (host convention, not framework surface).

### 2.2 Tool-result flag reconciliation (input vs output)

A tool result has three representations — the `tool-result` `AgBlock` (§2), the `tool.done` event (§4), and `AgInput.kind:"tool-result"` `results[]` (§3) — and `input == output minus the streaming envelope` (§0.3). The flag sets line up as:

- **Shared core** (all three): `toolCallId`, `content`, `outcome`, `structuredContent`, `uiData`, `sideData`, `errorText`, `errorCode`, `isError`, `providerMetadata`, `toolMetadata`, `dynamic`, `pendingInput`, `_meta`, `annotations`.
- **Output-only** (`tool.done` / block, NOT input): `skipSummarization`, `preliminary`, `more`. (Fold is code-canonical, §5: the block's typed `preliminary` mirrors the most recent `tool.done.more` value — `more:true` sets it and keeps the result open for a subsequent REPLACE-wholesale `tool.done`; the final, `more`-less `tool.done` clears it. There is no independent "`preliminary` without `more`" fold state.)
- **Input-only** (`results[]`, NOT output): `willContinue`, `scheduling`.

A client echoing a `tool.done` back as `kind:"tool-result"` carries the shared core verbatim, drops the output-only flags, and supplies input-only flags as needed.

> **Pydantic `RetryPromptPart` round-trip (mapping note, no schema change).** A Pydantic `RetryPromptPart` maps to `AgInput.kind:"tool-result"` `results[]` with `outcome:"error"`, `toolCallId`, optional `name`, and `errorText` carrying the serialized retry content; the structured `ErrorDetails[]` (`loc`/`msg`/`type`) is preserved **verbatim** under `_meta` (e.g. `_meta['pydantic/retryErrors']`) or `providerDetails`. The `tool_name`-None case (an output-VALIDATION retry, not a tool-call retry) is represented by omitting `name` (the retry targets the model's structured output, not a specific tool). This closes the latent RetryPromptPart gap.

## 3. Input — `AgInput`

`AgInput` is a **discriminated union on `kind`** over a shared envelope. Each variant carries only what its kind needs.

```ts
type AgRole = "user" | "assistant" | "tool" | "system";
// Normalizer: Gemini "model"→"assistant"; A2A "agent"→"assistant"; OpenAI "developer"→"system".
// NO "reasoning" / "activity" role. (Every framework already normalizes reasoning to an assistant
//   message whose content is a single reasoning block; there is no dedicated reasoning/activity role.)

// ── Reasoning request knob (neutral; covers OpenAI o-series effort + Anthropic/Gemini budgets) ──
interface AgReasoningConfig {
  mode: "enabled" | "disabled";
  effort?: "minimal" | "low" | "medium" | "high";   // OpenAI o-series; neutral mapping
  budgetTokens?: number;                              // Anthropic/Gemini thinking budget
}

// ── HITL answer (the resume payload; see §3.1 and §7) ──
interface AgHitlAnswer {
  askId: string;
  status: "resolved" | "declined" | "cancelled";   // preserves MCP accept/decline/cancel as status
  reply?: unknown;     // kind-typed by the originating ask.kind (approve-with-edits rides here)
  reason?: string;     // human rationale; reaches the model
  ordinal?: number;    // resume-binding ordinal for LangGraph positional in-node interrupts (§7, A25/A49)
  token?: string;      // server anti-forgery (MUST in side-effecting binding; see §11 item 4 (threat model: §13.1))
  requestState?: string;  // MCP MRTR opaque server continuation blob; MUST be echoed BYTE-IDENTICAL from
                          //   the originating ask; clients MUST NOT inspect/mutate. DISTINCT from token.
}

// ── Surface interaction (a DIFFERENT axis from HITL — a client→server surface message, not a pause) ──
// REPLACES the old merged AgUiAction. Each external UI spec keeps its OWN faithful field names
// behind a shared correlation envelope, so nothing is lost to a lossy merge. EXPLICIT discriminant on
// `surface` (reverses the old positional F8 identification); A2UI's three client→server legs carry a
// second inner discriminant `a2uiMessage` so they narrow without structural-presence guessing.

// Shared correlation envelope for ALL surface interactions (§1.3, §4 surface addressing).
// surfaceId/toolCallId/turnId/threadId/_meta stay at the AgJSON layer (NOT in the per-spec payload),
// so reduce()/replay stays addressable even though surfaces are live-only (§5).
interface AgSurfaceEnvelope {
  surface: "a2ui" | "mcp-app" | "openai-app";   // EXPLICIT discriminant (reverses the old positional F8)
  surfaceId: string;        // the LIVE render-side address (replaces the merged type's overloaded sourceId)
  toolCallId?: string;      // cross-ref to the producing tool-call
  turnId?: string;          // owning-turn cross-ref (§1.3)
  threadId?: string;        // root cross-ref (§1.3)
  _meta?: AgMeta;        // AgJSON-layer host annotations ONLY (the A2UI action.timestamp is NOT here anymore — it is a first-class field on the A2UI action arm)
}

// The surface-interaction union. Carried by AgInput.kind:"resume" uiActions[].
type AgSurfaceInteraction =
  | AgA2uiSurfaceAction
  | AgA2uiFunctionResponse
  | AgA2uiError
  | AgMcpAppViewMessage
  | AgOpenAiWidgetAction;

// ── A2UI v1.0 client→server `action` (A2UI-frozen field names kept VERBATIM, §0.4) ──
type AgA2uiSurfaceAction = AgSurfaceEnvelope & {
  surface: "a2ui"; a2uiMessage: "action";
  name: string;                       // A2UI action.name — REQUIRED
  sourceComponentId: string;          // A2UI action.sourceComponentId — REQUIRED
  timestamp: string;                  // A2UI action.timestamp — REQUIRED, ISO-8601 (first-class now; old _meta carrier bug fixed)
  context: Record<string, unknown>;   // A2UI action.context — REQUIRED resolved data-bindings (string-keyed map; values opaque per §0.1, map shape known — the sole sanctioned Record<string,unknown>, §0.1)
  wantResponse?: boolean;             // A2UI action.wantResponse (default false) → server actionResponse = ui.action-result
  actionId?: string;                  // A2UI action.actionId — REQUIRED-when-wantResponse===true
};

// ── A2UI v1.0 client→server `functionResponse` (inbound leg of the server callFunction RPC) ──
type AgA2uiFunctionResponse = AgSurfaceEnvelope & {
  surface: "a2ui"; a2uiMessage: "function-response";
  functionCallId: string;             // echoes callFunction.functionCallId
  call: string;                       // the function name called
  value: unknown;                     // the return value
};

// ── A2UI v1.0 client→server `error` (surface-side error report, upstream-faithful): carries
// EXACTLY ONE of surfaceId (surface-scoped) | functionCallId (function-call-failure), per A2UI
// v1.0's Generic Error oneOf ──
type AgA2uiError = Omit<AgSurfaceEnvelope, "surfaceId"> & {
  surface: "a2ui"; a2uiMessage: "error";
  surfaceId?: string;                 // overrides the envelope: XOR with functionCallId — surface-scoped error
  functionCallId?: string;            // XOR with surfaceId — function-call-failure error
  code: string; message: string;
  path?: string;                      // JSON-Pointer to the failed binding; REQUIRED when code === "VALIDATION_FAILED"
};

// ── MCP Apps 2026-01-26 view→host RPCs (nested union on the verbatim JSON-RPC method) ──
// MCP-frozen method names + content/structuredContent kept VERBATIM. Handshake/lifecycle
// (ui/initialize, ui/notifications/*) are host-internal and excluded.
type AgMcpAppViewMessage = AgSurfaceEnvelope & { surface: "mcp-app" } & (
  | { method: "ui/update-model-context";   // last-write-wins on surfaceId, deferred to next user turn
      params: { content?: AgBlock[]; structuredContent?: unknown } }
  | { method: "ui/message";                // role FIXED "user"; single text block; → injected-user-message path
      params: { role: "user"; content: { type: "text"; text: string } } }
  | { method: "ui/request-display-mode";   // NO modal (OpenAI-only); granted reply rides ui.display-mode
      params: { mode: "inline" | "fullscreen" | "pip" } }
  | { method: "ui/open-link"; params: { url: string } }
);

// ── OpenAI Apps SDK widget (window.openai) component→server RPCs (nested union on method) ──
// callTool is a SPEC-UNIQUE surface interaction, NOT the normalized tool-call.
// sendFollowUpMessage → injected user message (kind:"start"). OpenAI-only fields live ONLY here.
type AgOpenAiWidgetAction = AgSurfaceEnvelope & {
  surface: "openai-app";
  toolResponseMetadata?: unknown;        // window.openai.toolResponseMetadata global echo (OpenAI-only)
} & (
  | { method: "setWidgetState"; widgetState: unknown }
  | { method: "callTool"; name: string; args: unknown; callId: string }   // callId correlates ui.widget.result
  | { method: "sendFollowUpMessage"; prompt: string; scrollToBottom?: boolean }
  | { method: "requestDisplayMode"; mode: "inline" | "pip" | "fullscreen"; requestId: string }  // NO modal; granted reply rides ui.display-mode
);

interface AgClientCapabilities {
  frontendTools?: Array<{ name: string; description?: string; inputSchema: unknown }>;
  hitl?: { ask?: boolean; approveWithEdits?: boolean; form?: boolean; auth?: boolean };
  streaming?: { partialMessages?: boolean };
  uiResources?: { catalogs?: string[]; htmlResources?: boolean };
  state?: { jsonPatch?: boolean };
}

// Agent→client capabilities (the in-band other half of negotiation; §6, §11 item 5).
// A2A AgentCard-compatible superset, advertised on the first turn (carrier: agent.capabilities event, §4).
interface AgCapabilities {
  streaming?: { partialMessages?: boolean };
  pushNotifications?: boolean;
  securitySchemes?: AgAuthConfig[];
  extensions?: string[];          // foreign A2A active-extension URIs
  uiCatalogs?: string[];
  profile?: "CORE" | "EXTENDED" | "ADVANCED";
}

interface AgToolDef {
  name: string; description?: string; inputSchema: unknown; strict?: boolean;
  providerExecuted?: boolean;                         // server already ran it; client MUST NOT execute
  uiVisibility?: ("model"|"app")[];                   // MCP Apps access-control scope (from the tool's _meta.ui.visibility):
                                                      //   "model" = in tools/list + model-callable; "app" = app-only.
                                                      //   Host MUST exclude app-only tools from the agent tool list and reject cross-origin app calls.
  source?: { type: "mcp"; serverName: string } | { type: "function" } | { type: "frontend" };
  _meta?: AgMeta;
}

// Run configuration carried by the "start" kind.
interface AgRunConfig {
  model?: string; system?: string | AgBlock[];
  tools?: AgToolDef[];
  toolChoice?: "auto" | "none" | "required" | { type: "tool"; name: string };
  responseFormat?: { type: "json_schema"; name?: string; schema: unknown; strict?: boolean };
  reasoning?: AgReasoningConfig;
  maxTokens?: number; temperature?: number; topP?: number; stopSequences?: string[];
  context?: AgBlock[];                             // every framework's context reverts faithfully to AgBlock[]
  pushNotification?: { url: string; token?: string; auth?: { scheme: string; credentials?: string } };
}

// ── Shared envelope fields on EVERY AgInput variant ──
interface AgInputEnvelope {
  protocol: "agjson"; version: string;               // semver; minor = additive-only
  threadId: string; turnId: string; parentTurnId?: string;
  capabilities?: AgClientCapabilities;
  state?: unknown;                                   // shared-state echo (LangGraph input-direction state) — opaque (§11 item 1)
  metadata?: AgMeta;                              // may carry a namespaced runtime-replay handle (LangGraph langgraph/threadId, langgraph/checkpointId, …; A50) + per-call extras
}

// ── The discriminated union ──
type AgInput =
  // New user message + run config.
  | (AgInputEnvelope & {
      kind: "start";
      messages: AgMessage[];
      run?: AgRunConfig;
    })
  // Resume a paused turn: HITL answers + surface interactions.
  | (AgInputEnvelope & {
      kind: "resume";
      answers?: AgHitlAnswer[];
      uiActions?: AgSurfaceInteraction[];
    })
  // Client-executed tool results flowing back in.
  | (AgInputEnvelope & {
      kind: "tool-result";
      results: Array<{
        toolCallId: string; content: AgBlock[];
        outcome?: "ok"|"error"|"denied"|"input_required";
        structuredContent?: unknown; uiData?: unknown; sideData?: unknown;
        errorText?: string; errorCode?: string;
        providerMetadata?: AgProviderMeta; toolMetadata?: AgMeta; dynamic?: boolean;
        pendingInput?: { requestState?: string; inputKeys?: string[] };
        isError?: boolean;
        willContinue?: boolean; scheduling?: "when_idle"|"preempt"|"silent"; annotations?: AgAnnotations; _meta?: AgMeta
      }>;
    });
```

### 3.1 Resume semantics

The `resume` kind carries `answers` (HITL `AgHitlAnswer[]`, §7) and `uiActions` (surface interactions `AgSurfaceInteraction[]`, §6). HITL and surface-interaction are **deliberately distinct axes**: a HITL answer resolves a `turn.done` pause; an `AgSurfaceInteraction` is an ongoing surface interaction (a client→server A2UI / MCP-Apps / OpenAI-Apps message) that need not pause the turn.

**Replay-load-bearing resume handles.** Resume/answer back-normalization MUST echo the source runtime's continuation pointers verbatim when present (analogous to `providerMetadata`):

- **MCP MRTR:** `AgHitlAnswer.requestState` is echoed byte-identical; resume is modeled as a **fresh** `AgInput` carrying that echoed `requestState`.
- **LangGraph checkpoint:** the LangGraph checkpoint `thread_id` / `checkpoint_id` / `checkpoint_ns` (a SEPARATE runtime handle from the conversational `threadId`) ride a namespaced `AgInputEnvelope.metadata` (`langgraph/threadId`, `langgraph/checkpointId`, `langgraph/checkpointNs`); a resume that must hit a specific checkpoint MUST echo them.
- **LangGraph resume shape:** the resume payload SHAPE (scalar vs id-keyed map) is selected by the ask group's `resumeBinding` (§7), **not** inferred from `answers.length` — `resumeBinding` absent/single → `Command(resume=answers[0].reply)` (scalar); `resumeBinding:"id"` → the id-keyed map; `resumeBinding:"positional"` → the positional list reconstructed by sorting on `ordinal`.

### 3.2 `AgMessage` — the unified message object

There is **one** message type used in **both directions** (the old `AgInputMessage` is folded in). Input-only fields are optional.

```ts
interface AgMessage {
  id: string;
  role: AgRole;
  content: AgBlock[];
  turnId?: string;                  // owning turn (cross-ref) when persisted (§1.3)
  threadId?: string;                // root link when persisted (§1.3)
  candidateIndex?: number;          // n>1 candidate partition (absent ⇒ 0 — §5 partitioning); persisted so snapshot round-trips keep candidate identity
  referenceTurnIds?: string[];      // input-only: cross-turn references (NOT a parent link)
  messageMetadata?: unknown;        // opaque app bag — Vercel messageMetadata (usage accounting: totalTokens, model id) (A17); ALSO the home of the A2UI client data-model snapshot under the `a2uiClientDataModel` key (sendDataModel:true per-surface snapshot, keyed by surfaceId; re-homed here from the old AgUiAction.dataModel field — §6 Pattern 5, §11 item 1) and of the same snapshot when it rides A2A Message.metadata
  extensions?: string[];            // foreign A2A active-extension URIs (§0.5)
  metadata?: AgMeta;
  agentId?: string;                 // agent that produced this message (multi-agent attribution; A2-additive)
  agentName?: string;               // human-readable agent name (display; A2-additive)
  agentRole?: string;               // role of the agent in the pipeline (e.g. "researcher", "analyst"; A2-additive)
  model?: string;                   // model that produced this message (per-message model attribution; A2-additive)
  usage?: AgUsage;                  // per-message token usage landed from message.end.usage verbatim, cumulative flag preserved (A2-additive; INV-DELTA, §8 item 4)
}
```

`AgMessage` is the object `reduce()` reconstructs into `AgReduceResult.messages` (§5) and the unit persisted to `ThreadMessage`. OpenAI/Anthropic store:false/ZDR reasoning continuity rides the per-BLOCK `reasoning`/`search-result` `opaque` (not a message-level field); Vercel usage accounting rides `messageMetadata`; the A2UI `sendDataModel:true` client data-model snapshot rides `messageMetadata.a2uiClientDataModel` (§11 item 1).

## 4. Output — streaming events `AgEvent`

Flat, typed, id-correlated. Base on every event: `{ type, seq, id?, turnId?, messageId?, parentId?, _meta? }` — the envelope carries no timestamp; a host requiring one re-stamps outside the wire contract (a wall-clock field on the base envelope would invite non-deterministic stamping, contradicting §5.0 INV-FOLD). `seq` is an **ascending, gap-free ordinal scoped to one Normalizer instance — one invoke** (it restarts at 0 each invoke; INV-SEQ, §5.0; there is no cross-invoke global ordinal at this layer), `turnId` names the **owning turn** of the event, and `messageId` (when present) names the open message the event attaches to. Two arms give `messageId` a specialized reading: on `tool.done` it is the ADOPTION id of the landed tool message (§5, §8 item 15); on `turn.done` it names the `messageMetadata` target. Tool-call args arrive as raw partial-JSON fragments; the server MUST emit `tool.args.assembled {input}` with the reassembled object so thin clients never parse partial JSON.

**Per-turn routing.** When more than one turn is open (an interleaved subagent + parent), an event attaches to the open message of the turn named by its `turnId`, **never** to a positional "current turn." Single-turn top-level streams MAY omit `turnId` (it defaults to the sole open turn).

**Surface addressing.** `surfaceId`, when present on a `ui.*` event, names the A2UI / MCP-Apps / OpenAI-Apps render surface the event targets — a **LIVE render-side address, NOT a containment-tree entity**; surfaces are ephemeral and never folded into `AgReduceResult` (§5). There is no `surfaceId` row in §1.3.

Per §0.3, every `type` below is **dotted** (it is an event), except the three enumerated bare-noun events `error` / `source` / `handoff`. The dotless content-block `type`s live only inside `content.block`, `data`, and the `AgBlock[]` carried by tool results.

```ts
type AgEvent =
  // ── LIFECYCLE ──
  | { type: "turn.start"; threadId: string; turnId: string; trigger?: AgTrigger }   // top-level turns only; nested turns open via subagent.start
  | { type: "turn.done"; turnId: string; outcome: AgOutcome; finishReason: AgFinishReason; usage?: AgUsage; safety?: AgSafety[]; messageId?: string; messageMetadata?: unknown; taskState?: string }
  | { type: "turn.error"; turnId?: string; message: string; code?: string; retriable?: boolean; usage?: AgUsage }   // terminal; usage = accrued billing on the interrupted turn (recorded verbatim, mirrors turn.done)
  | { type: "turn.abort"; turnId?: string; reason?: string }
  | { type: "error"; code?: string; message: string; retriable?: boolean }        // NON-terminal
  | { type: "message.start"; id: string; role: AgRole; turnId: string; threadId: string; stepId?: string; extensions?: string[]; candidateIndex?: number; agentId?: string; agentName?: string; agentRole?: string; model?: string }  // opens an AgMessage boundary; candidateIndex absent ⇒ candidate 0 (§5 partitioning)
  | { type: "message.end"; id: string; usage?: AgUsage }                         // seals the message boundary; usage = per-message token carrier (review #4 carrier)
  | { type: "message.remove"; id: string | "*"; turnId?: string }                 // id="*" (REMOVE_ALL) requires turnId (§5); structural delete
  | { type: "step.start"; stepName?: string; id: string; turnId?: string }
  | { type: "step.done"; stepName?: string; id: string; usage?: AgUsage }
  | { type: "prompt.blocked"; reason: "safety"|"blocklist"|"prohibited"|"other"; safety?: AgSafety[] }
  // ── CAPABILITY NEGOTIATION (agent→client, first turn) ──
  | { type: "agent.capabilities"; capabilities: AgCapabilities }
  // ── RECONNECT / RESYNC ──
  | { type: "messages.snapshot"; messages: AgMessage[]; turns?: AgTurnRecord[]; artifacts?: AgArtifact[]; memory?: AgMemoryRecord[] }  // full-state resync (A12); memory REPLACES ONLY scope="thread" records (CRITICAL #3)
  | { type: "host.context"; theme?: unknown; capabilities?: unknown; container?: unknown }  // host display/runtime hint — `capabilities` here is the HOST surface's render hint, DISTINCT from the agent's `agent.capabilities` negotiation payload (A30); live-only, never folded
  // ── TEXT ──
  | { type: "text.start"; id: string; role?: "assistant"; parentId?: string; index?: number; previousPartKind?: string; providerMetadata?: AgProviderMeta; candidateIndex?: number }  // candidateIndex absent ⇒ candidate 0 (§5 partitioning)
  | { type: "text.delta"; id: string; delta: string; providerMetadata?: AgProviderMeta }   // APPENDS
  | { type: "text.end"; id: string; providerMetadata?: AgProviderMeta; citations?: AgCitation[] }  // citations = the STREAMED-text citations carrier (audit M22): attaches to the sealed `text` block named by `id`; a normalizer MUST NOT re-emit the text as a duplicate supplement block
  // ── REASONING ──
  | { type: "reasoning.start"; id: string; mode?: "summarized" | "full"; partIndex?: number; previousPartKind?: string; providerMetadata?: AgProviderMeta; itemId?: string; candidateIndex?: number }  // partIndex opens a new summary part (OpenAI summary_index → partIndex); candidateIndex absent ⇒ candidate 0
  | { type: "reasoning.delta"; id: string; delta: string; partIndex?: number; providerMetadata?: AgProviderMeta }  // APPENDS
  | { type: "reasoning.end"; id: string; provider?: string; providerMetadata?: AgProviderMeta }
  | { type: "reasoning.opaque"; id: string; kind: "signature"|"ciphertext"|"encrypted"|"redacted"; value: string; provider?: string; itemId?: string }  // REPLACE — sets opaque on the reasoning block (default; the Anthropic thinking signature / OpenAI rs_ encrypted_content / Gemini thoughtSignature-on-thought / Pydantic signature carrier)
  | { type: "reasoning.opaque.delta"; id: string; delta: string }   // APPENDS to a signature scratch buffer (Pydantic signature_delta); sealed by reasoning.opaque
  // ── TOOL CALL (stateful reassembly) ──
  | { type: "tool.start"; toolCallId: string; name: string; parentId?: string; index?: number; dynamic?: boolean; serverName?: string; providerExecuted?: boolean; requiresApproval?: boolean; title?: string; toolMetadata?: AgMeta; uiVisibility?: ("model"|"app")[]; itemId?: string; providerMetadata?: AgProviderMeta; candidateIndex?: number; longRunning?: boolean }  // candidateIndex absent ⇒ candidate 0 (§5 partitioning)
  | { type: "tool.args.delta"; toolCallId: string; delta: string }     // RAW PARTIAL JSON STRING (APPENDS)
  | { type: "tool.args.assembled"; toolCallId: string; input: unknown; signature?: string; title?: string; toolMetadata?: AgMeta; providerMetadata?: AgProviderMeta }  // reassembled object (MANDATORY); Gemini's tool-call signature rides here / tool-call.signature
  | { type: "tool.done"; toolCallId: string; messageId?: string; content: AgBlock[]; outcome?: "ok"|"error"|"denied"|"input_required"; structuredContent?: unknown; uiData?: unknown; sideData?: unknown; errorText?: string; errorCode?: string; providerMetadata?: AgProviderMeta; toolMetadata?: AgMeta; dynamic?: boolean; pendingInput?: { requestState?: string; inputKeys?: string[] }; isError?: boolean; skipSummarization?: boolean; more?: boolean; preliminary?: boolean; candidateIndex?: number }  // carries the tool-result; candidateIndex absent ⇒ candidate 0 (§5 partitioning)
  // ── ATOMIC BLOCK DELIVERY ──
  | { type: "content.block"; block: AgBlock; transient?: boolean; candidateIndex?: number }  // emit one whole, non-streamed block (the noun-final EVENT exception, §0.3); candidateIndex absent ⇒ candidate 0
  | { type: "message.metadata"; messageId?: string; metadata: AgMeta }
  | { type: "source"; sourceId: string; source: AgSourcePayload; chunkIndex?: number; providerMetadata?: AgProviderMeta }
  // ── STREAMED ARTIFACTS (A2A) ──
  | { type: "artifact.start"; artifactId: string; turnId: string; threadId: string; name?: string; description?: string; parentId?: string; extensions?: string[] }
  | { type: "artifact.delta"; artifactId: string; part: AgBlock; append: boolean }
  | { type: "artifact.end"; artifactId: string; lastChunk: true }
  // ── MANDATORY DISPLAY ──
  | { type: "display.required"; provider: string; html: string }       // ToS-must-render grounding (was provider_display/mandatoryDisplay)
  // ── SUBAGENT / HANDOFF ──
  | { type: "subagent.start"; turnId: string; parentTurnId: string; agentId?: string; agentName?: string }   // the SOLE nested-turn opener
  | { type: "subagent.done"; turnId: string; parentTurnId: string }
  | { type: "handoff"; kind?: "transfer"|"escalate"; fromAgentId?: string; toAgentId?: string; toAgentName?: string }
  // ── HITL (one family; see §7) ──
  | { type: "hitl.ask"; askId: string; kind: "approval"|"form"|"text"|"choice"|"auth"|"url"; message?: string; schema?: unknown; choices?: AgChoice[]; authConfig?: AgAuthConfig; url?: string; toolCallId?: string; continuation?: "resume"|"turn"; reason?: string; metadata?: AgMeta; requestState?: string; inputKey?: string; resumeBinding?: "id"|"positional"; ordinal?: number; token?: string; expiresAt?: string }
  // ── AGENT ↔ SURFACE RPC (A2UI v1.0 + OpenAI Apps SDK) ──
  | { type: "ui.call"; surfaceId: string; callId: string; method: string; args?: unknown; wantResponse?: boolean; callableFrom?: "clientOnly"|"remoteOnly"|"clientOrRemote" }  // callableFrom round-trips the A2UI clientOnly-rejection contract; the reciprocal rejection rides ui.result.error
  | { type: "ui.result"; surfaceId: string; callId: string; method?: string; value?: unknown; error?: { code: string; message: string; path?: string } }  // method echoes ui.call.method for the A2UI functionResponse.call leg (A21); error.path = JSON-Pointer for an A2UI VALIDATION_FAILED reciprocal rejection
  | { type: "ui.action-result"; surfaceId: string; actionId: string; value?: unknown; error?: { code: string; message: string; path?: string } }  // server actionResponse to a client-initiated A2UI action (A22); error.path = JSON-Pointer for an A2UI VALIDATION_FAILED
  | { type: "ui.widget.result"; surfaceId: string; callId: string; result: string }  // OpenAI Apps SDK window.openai.callTool reply leg — `result` (a string) is returned to the widget; `callId` correlates the originating AgOpenAiWidgetAction(method:"callTool"); live-only / non-folding (§5)
  | { type: "ui.display-mode"; mode: "inline"|"pip"|"fullscreen"; granted?: "inline"|"pip"|"fullscreen"; surfaceId?: string; toolCallId?: string }  // granted = authoritative reply leg (A52); surfaceId scopes a per-surface display request. Display modes track the pinned upstream surfaces (§14 References): OpenAI Apps SDK DisplayMode = pip | inline | fullscreen (OpenAI's modal is the separate requestModal API, NOT a display mode and NOT carried here); MCP Apps ui/request-display-mode likewise has no modal.
  // ── A2UI SURFACE LIFECYCLE + DATA-MODEL PUSH (server→renderer; opaque, ADVANCED) ──
  | { type: "ui.surface.start"; surfaceId: string; catalogId: string; surfaceProperties?: unknown; sendDataModel?: boolean; components?: unknown; dataModel?: unknown; toolCallId?: string }  // A2UI createSurface; catalogId REQUIRED (carried BY REFERENCE — the catalog itself is never transmitted); components/dataModel/surfaceProperties OPAQUE unknown (zero component schema); toolCallId MAY link the surface to the producing tool-call
  | { type: "ui.surface.update"; surfaceId: string; components: unknown }   // A2UI updateComponents — the streamed adjacency-list passes through VERBATIM
  | { type: "ui.surface.end"; surfaceId: string }                          // A2UI deleteSurface
  | { type: "ui.data-model"; surfaceId: string; path?: string; value?: unknown }  // A2UI updateDataModel server→surface push; path is a JSON-Pointer defaulting to "/", absent value = delete-at-path, value OPAQUE
  // ── OPAQUE / ADVANCED STATE PASSTHROUGH ──
  | { type: "state.snapshot"; snapshot: unknown }                      // LangGraph "values" stream mode (full graph-state dict after each node)
  | { type: "state.delta"; patch: unknown }                            // LangGraph "updates" stream mode ({node_name:{key:value}}) OR an RFC-6902 JSON Patch — both opaque on the same carrier
  // ── MEMORY SIDE-CHANNEL ──
  // value and patch are mutually exclusive (exactly one required — enforced at parse, CRITICAL #2).
  // absent key ⇒ scope-default record. scope="agent"/"user"/"skill" are cross-thread (durable).
  | { type: "memory.write"; scope: "agent"|"user"|"skill"|"thread"; key?: string; value?: unknown; patch?: unknown; reason?: string; durable?: boolean }
  // ── GUARDRAIL EVALUATION (A2-additive; folded onto AgTurnRecord.guardrails[]) ──
  | { type: "guardrail.result"; target: "input"|"output"|"tool"; passed: boolean; action?: "block"|"retry"|"rewrite"|"override"|"terminate"; reason?: string; guardrailName?: string; safety?: AgSafety[] }
  // ── NAMESPACED VENDOR EXTENSION (RFC-6648: no x- prefix) ──
  | { type: `ext.${string}.${string}`; [k: string]: unknown };

type AgChoice = { id: string; label: string; value?: unknown };
type AgAuthConfig = { scheme: string; scopes?: string[]; authorizationUrl?: string; tokenUrl?: string; clientId?: string; audience?: string };  // extra fields carry ADK credential-exchange (A46)
type AgSafety = { category: string; score?: number; probability?: string; blocked?: boolean };

// What triggered a turn (A2-additive; folded from turn.start.trigger onto AgTurnRecord.trigger).
type AgTrigger = {
  kind: "user" | "resume" | "schedule" | "webhook" | "email" | "agent" | "cron" | "unknown";
  ref?: string;  // opaque correlation id, cron expression, webhook path, etc.
};

// A single paused ask entry (shared between hitl.ask and AgOutcome.paused.asks[]).
type AgPausedAsk = {
  askId: string; kind: "approval"|"form"|"text"|"choice"|"auth"|"url"; message?: string;
  toolCallId?: string; schema?: unknown; choices?: AgChoice[]; authConfig?: AgAuthConfig; url?: string;
  reason?: string; metadata?: AgMeta;             // free-form ask rationale + arbitrary bag — the ONLY lossless carrier for LangGraph interrupt(value: Any) (A23)
  requestState?: string; inputKey?: string;          // MCP MRTR continuation (A9)
  resumeBinding?: "id"|"positional"; ordinal?: number;  // LangGraph positional binding (A25)
  token?: string; expiresAt?: string
};

type AgOutcome =
  | { type: "success"; result?: unknown }
  | { type: "error"; message: string; code?: string }
  | { type: "rejected"; reason?: string }                       // A2A task-level "rejected" — DISTINCT from the tool-call "rejected" finishReason (A44)
  | { type: "aborted"; reason?: string }                        // turn.abort's dedicated marker, symmetric with "error"; taskState is verbatim-A2A only and is NEVER reducer-invented (audit M29)
  // within-run pause: the turn parks on one or more HITL asks (was "interrupt"/"await")
  | { type: "paused"; asks: AgPausedAsk[]; result?: unknown };  // result MAY accompany a pause (a partial value emitted before parking)

type AgFinishReason =
  | "stop"
  | "token_limit"             // was "length" — the output max-tokens cap
  | "context_window_exceeded" // Claude 4.5+ model_context_window_exceeded — DISTINCT from token_limit (compact/split vs raise max_tokens) (A38)
  | "tool_call"               // was "tool_use"
  | "paused"                  // HITL pause only (was "interrupt"/"await")
  | "pause_turn"              // Anthropic server-loop checkpoint — NON-HITL, no asks[], re-input is a plain replay (A20)
  | "refusal"
  | "safety_blocked"          // collapses content_filter/prohibited_content/spii/recitation — see §10 conformance MUST
  | "malformed_tool_call" | "unexpected_tool_call" | "rejected"   // single-source, tagged (tool-call rejection)
  | "other" | "unknown";      // neutral targets for Vercel "other" / SDK-core "unknown" (A56)

interface AgUsage {
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
  reasoningTokens?: number; toolUseInputTokens?: number; totalTokens?: number; costUsd?: number;
  cumulative?: boolean;   // true = values are the provider's RUNNING TOTALS, preserved verbatim (Anthropic) — consumers derive per-step by subtracting adjacent snapshots; false/absent = per-step (Pydantic/Vercel)
  byModel?: Record<string, AgUsage>;  // per-model breakdown (self-recursive; A2-additive)
  serverToolRequests?: number;        // server-executed MCP tool-request count for quota reporting
}
```

> **`safety_blocked` conformance.** A normalizer emitting `finishReason: "safety_blocked"` (or `prompt.blocked`) SHOULD populate `safety[].category` so the collapsed reason (content_filter / prohibited_content / spii / recitation) remains recoverable. When the source emits only a bare content-filter signal with no category (e.g. Vercel's UI stream), `safety_blocked` MAY be emitted with an empty `safety[]`. See §10.

> **`costUsd` population.** `costUsd` carries a provider-REPORTED cost figure verbatim (e.g. OpenRouter `usage.cost`, Anthropic `total_cost_usd`); a normalizer never COMPUTES cost. Hosts that meter independently simply ignore it.

> **Vercel usage convention.** When usage accounting is routed through `messageMetadata` (Vercel's `totalUsage.totalTokens` + model id), it is conventionally carried on the open assistant message's `messageMetadata` (or `turn.done.messageMetadata`), folded REPLACE-merge verbatim (§5). Only `AgMessage.messageMetadata`, `turn.done.messageMetadata`, and the open assistant message are carriers; `turn.start` carries **no** `messageMetadata` field.

## 5. `reduce()` — stream → object (normative, complete folding table)

### 5.0 Fold & stream invariants (normative)

The invariants below ARE the contract between a Normalizer (§8.0), the engine, and `reduce()`. Conformance (§10) tests them. They are stated as behavior; implementations and reviews MUST cite them by these names.

**INV-FOLD (determinism & live/history identity).** Folding a stream's events through `reduce()` in ascending per-invoke order reproduces the persisted `AgReduceResult`; incremental (live) and batch (history) folds of the same events converge to **structurally identical** results — deep equality with arrays order-sensitive (blocks materialize in ascending `seq` of their creating events; a later same-id reconcile updates in place without changing position) and object keys order-insensitive; no number-formatting claim is made. Two conformant `reduce()` implementations produce structurally identical results for the same stream. (The batch surface returns `{ result, needsResync }`; the equality claim binds `result`.) _(Non-normative: a byte-comparison profile MAY canonicalize with RFC 8785 JCS first.)_

**INV-TURN (turn closure).** Every turn is opened by exactly one `turn.start`; a normalizer MUST synthesize `turn.start` before emitting any content event for a turn the stream has not opened (duplicate turn-opens are idempotent and merge fields — including `threadId` and `trigger`). Every opened turn is closed by exactly one of `turn.done` | `turn.error` | `turn.abort`. A normalizer whose stream ends with a turn still open MUST close it at flush with `turn.abort` (reason: stream-truncated) or `turn.error` carrying the interruption — **never** a success `turn.done`.

**INV-MSG (message closure & seal).** Every `message.start` is paired with exactly one `message.end`; `flush()` synthesizes `message.end` for each still-open message in insertion order. `message.end` **seals** the message: a block-creating or delta event targeting a sealed message — or any message of a closed turn — is a `reduce()`-error → snapshot-resync, never a silent attach. `message.remove` of a sealed message un-seals it per the pointer-revert rule (§5 table).

**INV-BLOCK (block identity & order).** Blocks append to `message.content[]` in ascending `seq` of their creating event; a same-id `content.block` reconciles/REPLACEs in place. Streaming block ids and toolCallIds MUST be unique within a fold: a block-creating `*.start` naming an id already present is a `reduce()`-error → snapshot-resync (never a duplicate append). Normalizers MUST mint collision-free **derived** ids when the framework omits one (e.g. `${turnId}:${kind}:${ordinal}`); identity MUST never derive solely from a per-event positional index.

**INV-DELTA (true deltas & usage).** Every `*.delta` carries only the increment — blind concatenation is safe. De-cumulation of cumulative **content** streams is a normalizer duty (the engine slices the per-id prior string). Cumulative **usage** is NOT de-cumulated anywhere: normalizers flag `cumulative: true` and preserve the provider's running totals verbatim; `reduce()` lands usage verbatim; per-step deltas are a consumer derivation (subtract adjacent snapshots). Complete-message sources are fragmented start→delta→end. Batch and incremental folds converge (INV-FOLD).

**INV-SEQ (sequencing).** `seq` is an ascending, gap-free ordinal scoped to **one Normalizer instance (one invoke)**, starting at 0 each invoke and ascending across nested turns within that invoke. `reduce()` parks (snapshot-resync; only `messages.snapshot`/`state.snapshot` un-park) **only on a forward gap** (`ev.seq > lastSeq + 1`); backward jumps — a new invoke's 0-restart — update `lastSeq` downward and fold normally. **This backward tolerance is normative.** There is no cross-invoke global ordinal and no reconnect high-water resume at this layer; a host requiring a global ordinal re-stamps outside the normalizer. A conformant reducer MUST expose its resync condition to the caller.

**INV-OWNER (total id / owner coverage).** Every turn, message, block, and tool call carries an id, and every emitted event resolves to its owning turn (explicit `turnId` → owning message via `messageId` → last-opened turn — restored to the PARENT when a subagent turn closes). All engine emit paths, including the generic `emit()`, apply the same owner backfill as the sugar primitives. `tool.done.messageId`, when present, names the landed tool-result message's own id (adoption). A reducer encountering an unresolvable owner degrades loudly (`reduce()`-error → resync), never a silent no-op.

**INV-FLUSH (end of stream).** `flush()` is a normative term: at end of stream a normalizer (1) emits a synthetic `message.end` for each still-open message, in insertion order; (2) closes each still-open turn per INV-TURN (`turn.abort`/`turn.error`, never success); still-open turns close in REVERSE opening order (innermost nested turn first); (3) emits nothing else — no synthetic `text.end`/tool closes; dangling per-block scratch is dropped.

The persisted state MUST be reconstructible from the event stream by a `reduce()` such that **`reduce(events).result == AgReduceResult`** (the batch surface also returns `needsResync` — INV-SEQ's exposed resync condition) under the INV-FOLD structural-equality relation (§5.0) — the live-SSE ↔ history-read invariant, where `AgReduceResult = { messages, artifacts, turns, state? }` (§2) holds the message tree, the artifact side-channel, per-turn records, and the shared-state copy. Events fold in **ascending per-invoke `seq`**; a **forward gap** (`ev.seq > lastSeq + 1`) triggers a snapshot-resync (request a fresh `messages.snapshot`/`state.snapshot`), never a partial guess; a **backward jump** — a new invoke's 0-restart — updates the reducer's high-water mark downward and folds normally (normative backward tolerance; INV-SEQ, §5.0).

**Trust boundary.** A reducer ingesting events across a trust boundary (network, storage, another process) MUST validate each event against `AgEvent` (or an equivalent schema) BEFORE folding — a validation failure is a typed error to the caller, never a fold and never a silent skip; within one validated pipeline, re-validation inside the fold is NOT required (the fold's precondition is already-parsed events).

**Message partitioning (load-bearing).** `message.start` opens an `AgMessage` keyed by `id` under the turn named by `turnId`. Subsequent block-creating events (`text.start` / `reasoning.start` / `tool.start` / `content.block` / `tool.done`) **of that turn** attach to the **most-recently-opened message of that turn for its `candidateIndex` (absent ⇒ 0)** and inherit its `id` as their `messageId`, until the next `message.start` in that turn or `turn.done`. The partition key is **`(turnId, candidateIndex)`** — absent ⇒ 0 keeps every existing single-candidate stream structurally identical (the back-compat anchor). `message.end` seals the message. When multiple turns are open, a block attaches to the open message of the turn named by the **event's `turnId`**, never to a positional "current turn."

**Block insertion order.** Blocks are **appended** to `message.content[]` in ascending `seq` of their creating event (`text.start` / `reasoning.start` / `tool.start` / `content.block`); a later same-id REPLACE updates **in place** without changing position. This makes two conformant `reduce()` implementations structurally identical for interleaved-block-kind turns (INV-FOLD, §5.0).

**Turn-open idempotency.** Opening a turn is **idempotent on `turnId`**; a second open for an existing `turnId` (a duplicate `turn.start`/`subagent.start`) merges fields, never duplicates the turn.

**Surface interactions are live-only.** The `AgSurfaceInteraction` family (`AgA2uiSurfaceAction` / `AgA2uiFunctionResponse` / `AgA2uiError` / `AgMcpAppViewMessage` / `AgOpenAiWidgetAction`) is an INPUT construct (`AgInput.kind:"resume"` `uiActions[]`), not an event in this output stream, and it is never folded into `AgReduceResult`; the surface RPC EVENTS that mirror it (`ui.*`) are live-only / non-folding (below), exactly as before the un-merge. The `a2uiClientDataModel` snapshot is the one surface-interaction datum that DOES persist — it rides `AgMessage.messageMetadata` and folds with that message (§3.2, §11 item 1).

The table below is exhaustive: **every** event type states its folding semantics. Any event type not listed is **live-only / non-folding** (delivered to the live client, never persisted).

| Event type            | Fold semantics                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `turn.start`          | Open a `turn` (`turnId`, `threadId`) as an `AgTurnRecord`; top-level only; idempotent on `turnId`. Subsequent entities attach under it. Record `trigger` if present. |
| `turn.done`           | Close the turn; record `finishReason`/`usage`/`safety`/`taskState`; if `outcome.type==="paused"`, record the asks; `messageMetadata` REPLACE-merges onto the message named by `turn.done.messageId` when present, else the open message of the turn. `finishReason:"pause_turn"` records a resumable checkpoint with **no** asks[] (re-input is a plain replay, NOT a resume kind). |
| `turn.error`          | Terminal; mark the turn errored. **Non-folding into content** (no block produced). Record `usage` verbatim when present (mirrors `turn.done`; the accrued cost of the errored turn).                          |
| `turn.abort`          | Terminal; fold `outcome = {type:"aborted", reason?}` on the turn record. `taskState` is NEVER reducer-invented (verbatim A2A only). **Non-folding into content.** |
| `error`               | **Live-only / non-folding** (non-terminal advisory).                                                        |
| `message.start`       | Open an `AgMessage` keyed by `id` under the turn named by `turnId` (`stepId`, when present, rides the wire for live consumers only — steps do not fold); record `extensions`, `candidateIndex`. Becomes the most-recently-opened message of the `(turnId, candidateIndex)` partition. |
| `message.end`         | Seal the message named by `id` (no further blocks attach to it). Record per-message `usage` if present (the review #4 carrier — per-message token accounting, distinct from the turn-level `turn.done.usage`). |
| `message.remove`      | REMOVE the `AgMessage` keyed by `id` from `AgReduceResult.messages` **and the blocks inside its `content[]`**. Tool-result messages that adopted their own `id` via `tool.done.messageId` are removed ONLY by their own `message.remove` — **no cascade** (review should-fix). Removing a message also **clears it as the most-recently-opened target**: the open-message pointer for `(turnId, candidateIndex)` reverts to the highest-`seq` still-present un-sealed message of that `(turn, candidate)`, or to **none** — in which case a subsequent block-creating event with no intervening `message.start` is a **`reduce()`-error → snapshot-resync**, never an implicit re-open (CRITICAL #1). `id === "*"` (REMOVE_ALL) removes every message of **exactly** the turn named by `turnId` (zero matches = deterministic **no-op**, not error); `id === "*"` with **no** `turnId` is malformed → rejected at parse, never folded (CRITICAL #2). Structural delete, non-folding into content; remaining messages keep ascending-`seq` order. |
| `step.start`          | **Live-only structural marker** — steps have NO `AgReduceResult` container and fold to nothing (ratified; the wire carries step boundaries for live consumers only).                |
| `step.done`           | **Live-only structural marker** — `step.done.usage` has no fold target; `turn.done.usage` is the authoritative turn-level accounting. Folds to nothing.                        |
| `prompt.blocked`      | Record `AgTurnRecord.promptBlocked = {reason, safety?}` on the turn AND merge `safety[]` into the turn's safety. **Non-folding into content.** |
| `guardrail.result`    | Append a guardrail evaluation record to `AgTurnRecord.guardrails[]` (`target`, `passed`, `action?`, `reason?`, `guardrailName?`, `safety?`). **Non-folding into content.** |
| `agent.capabilities`  | Record the agent's `AgCapabilities` on the turn (first-turn negotiation). **Non-folding into content.**  |
| `messages.snapshot`   | **REPLACE** the working message set; `turns` and `artifacts` are replaced **per-container conditionally** — ONLY when the snapshot carries the corresponding `turns?`/`artifacts?` container; an OMITTED container is PRESERVED (ratified; a messages-only snapshot never wipes prior turns/artifacts). If `memory?` is present, REPLACE ONLY `scope==="thread"` records in `AgReduceResult.memory`; `scope="agent"/"user"/"skill"` (durable, cross-thread) records are a SEPARATE persistence axis **untouched** by a per-thread snapshot (CRITICAL #3). **Clear ALL transient reduce() state** — per-`toolCallId` arg scratch buffers and any open/un-sealed blocks — so no pre-snapshot delta is re-applied after the REPLACE. |
| `host.context`        | **Live-only / non-folding** (host hint).                                                                    |
| `text.start`          | Create a `text` block keyed by `id`; merge `providerMetadata` (REPLACE-by-key); merge `_meta` into the block's `_meta` (LangGraph node/tag attribution survives). |
| `text.delta`          | **APPEND** `delta` to the `text` block named by `id`; merge `providerMetadata` (REPLACE-by-key) if present. |
| `text.end`            | Seal the `text` block; merge `providerMetadata` (REPLACE-by-key, last-writer-wins); attach `citations[]` to the block when present (the STREAMED-text citation carrier — audit M22). |
| `reasoning.start`     | Create a `reasoning` block keyed by `id`; set `itemId`; merge `providerMetadata`/`_meta`. `partIndex` opens a new summary part. |
| `reasoning.delta`     | **APPEND** `delta` to `reasoning.text` (to the part named by `partIndex` when present; `text` is the in-order concatenation of parts); merge `providerMetadata`. |
| `reasoning.end`       | Seal the `reasoning` block; merge `providerMetadata` (REPLACE-by-key).                                      |
| `reasoning.opaque`    | **REPLACE** `opaque = { kind, value, provider }` on the **reasoning** block named by `id` (the sole behavior); set `itemId` if present (replay-load-bearing). This is the Anthropic thinking-signature / OpenAI `rs_` encrypted_content / Gemini thoughtSignature-on-thought-and-grounding / Pydantic signature carrier. |
| `reasoning.opaque.delta` | **APPEND** `delta` to a per-`id` signature scratch buffer (Pydantic `signature_delta`); the assembled value is sealed by the following `reasoning.opaque` REPLACE. |
| `tool.start`          | Create a `tool-call` block keyed by `toolCallId` (set `name`, flags, `title`, `toolMetadata`, `uiVisibility`, `itemId`, `providerMetadata`). |
| `tool.args.delta`     | **APPEND** the raw partial-JSON `delta` to a scratch buffer for `toolCallId` (never the authoritative input). |
| `tool.args.assembled` | **AUTHORITATIVE** for `tool-call.input` (set it from `input`; discard the scratch buffer). Set `signature`, `title`, `toolMetadata`, `providerMetadata` if present. |
| `tool.done`           | Land a `tool-result` block for `toolCallId`: `content`, `outcome`, `structuredContent`, `uiData`, `sideData`, `errorText`, `errorCode`, `providerMetadata`, `toolMetadata`, `dynamic`, `pendingInput`, `isError`. If `messageId` present, the landed tool-result message adopts it as its own id (stable ToolMessage identity). (`more:true` ⇒ sets the block's typed `preliminary` flag and keeps the result open; a subsequent `tool.done` for the same `toolCallId` REPLACES the result fields wholesale — merge = REPLACE, code-canonical — and the final, `more`-less result clears `preliminary`. A `tool.done` targeting a closed turn's result is a `reduce()`-error → resync (never a silent mutation).) |
| `content.block`       | Insert `block` (appended in `seq` order); if a block with the same `id` exists, **REPLACE** it in place (reconcile-by-id). `transient:true` ⇒ **SKIP**. |
| `message.metadata`    | Merge `metadata` into the message named by `messageId` (the open assistant message when absent).            |
| `source`              | Land the FULL record on `AgTurnRecord.sources[]` ({sourceId, source, chunkIndex?, providerMetadata?}) — `sourceIds[]` stays as the derived binding index (citations resolve post-fold). Synthesized `source.sourceId` order MUST preserve the original `groundingChunks[]` array order (or carry `chunkIndex`) so chunk-index citations bind correctly. |
| `artifact.start`      | **Artifact side-channel landing** — open an `AgArtifact` (keyed by `artifactId`, with `turnId`/`threadId`/`extensions`) in `AgReduceResult.artifacts`; NOT an `AgBlock` (§1.3). |
| `artifact.delta`      | `append:false` ⇒ **start a new part**; `append:true` ⇒ **concatenate onto the last part** (into the side-channel, not `content`). |
| `artifact.end`        | Seal the artifact (side-channel).                                                                           |
| `subagent.start`      | Open a nested turn (`turnId`, `parentTurnId`); idempotent on `turnId`; fold its events under that nested turn. |
| `subagent.done`       | Close the nested turn.                                                                                      |
| `handoff`             | Record the handoff edge on the turn. **Non-folding into content.**                                          |
| `display.required`    | Record on the turn (`AgTurnRecord.displayRequired`) for replay; **non-folding into content** but MUST NOT be dropped (ToS). (Duty bearer split: §13.3.) |
| `state.snapshot`      | **REPLACE** the shared-state working copy (resync) — the LangGraph `values` stream mode (full graph-state dict).  |
| `state.delta`         | Apply the patch to the shared-state working copy — **RFC-6902 JSON Patch** for the JSON-Patch case, **node-keyed last-writer-wins merge** (`{node_name:{key:value}}`) for the LangGraph `updates` case; both opaque payloads (`patch:unknown`) on the same carrier. |
| `memory.write`        | Land/update an `AgMemoryRecord` keyed by `(scope, key)` in `AgReduceResult.memory`; an absent `key` targets the scope-default record `(scope, "")` — exactly one keyless record per scope. `value` and `patch` are **mutually exclusive per event** (an event with both is rejected at parse): `value` sets the record; `patch` (RFC-6902) mutates it in place — a `patch` against a `(scope, key)` with **no existing value is a `reduce()`-error → snapshot-resync** (writer MUST seed a `value` first), never silently based on `{}` (review #7). `durable:true` marks cross-thread persistence; side-channel, never into content. |
| `data` (as a block via `content.block`) | Reconcile-by-id: same `id` ⇒ **REPLACE** in place; `transient:true` ⇒ **SKIP**.                  |
| `hitl.ask`            | **Live-only** (the within-run pause is recorded by `turn.done.outcome="paused"`, above).                    |
| `ui.call` / `ui.result` / `ui.action-result` / `ui.widget.result` / `ui.display-mode` / `ui.surface.*` / `ui.data-model` | **Live-only / non-folding** (surface RPC + ephemeral surface state). `ui.widget.result` (the OpenAI Apps `callTool` reply) is likewise live-only / non-folding. |
| `ui.surface.start` / `ui.surface.update` / `ui.surface.end` / `ui.data-model` | **Live-only / non-folding** (ephemeral surface render state, like `host.context`). |
| `ext.<vendor>.<key>`  | **Live-only / non-folding** unless a vendor profile defines folding.                                        |

**Citation attachment key.** A citation attaches to the `text` block whose `id` it accompanies (carried inline on the block's `citations[]`); offset-kind citations additionally reference grounding sources by `AgCitation.sourceIds` → `source.sourceId`, and `partIndex` anchors the byte range to the correct response part. For STREAMED text, citations arrive on `text.end.citations` and attach to the sealed block — a normalizer MUST NOT re-emit the text as a supplement block (duplicate-fold hazard).

**Replay vs append summary.** Deltas (`text.delta`, `reasoning.delta`, `tool.args.delta`, `reasoning.opaque.delta`) **APPEND**. `reasoning.opaque`, same-id `content.block`/`data`, `messages.snapshot`, `state.snapshot` **REPLACE**. (`messages.snapshot` replaces `turns`/`artifacts`/`memory` per-container conditionally — omitted containers are preserved.) `tool.args.assembled` is authoritative. `transient:true` is **skipped**. `message.remove` **DELETES** the named message (or all messages of the turn for `id="*"`); the open-message pointer for the `(turnId, candidateIndex)` partition reverts accordingly (CRITICAL #1). Artifacts land in a **side-channel** (`AgReduceResult.artifacts`), never inside `AgBlock[]`. Memory writes land in a separate **side-channel** (`AgReduceResult.memory`); `scope="agent"/"user"/"skill"` records are durable cross-thread and untouched by per-thread snapshots (CRITICAL #3). `providerMetadata`/`toolMetadata` MERGE REPLACE-by-key onto their block. Block `annotations` (MCP `audience`/`priority`/`lastModified`) carry through `reduce()` **UNCHANGED**. The surface-interaction family and the `ui.*` surface RPC events are **live-only / non-folding** (the un-merged `AgSurfaceInteraction` carries no new folding semantics); the lone persisted surface datum is the `a2uiClientDataModel` snapshot on `AgMessage.messageMetadata`.

## 6. UI-interaction model

AgJSON adds zero render layer; it provides the boundary-crossing anchors. There are **two co-equal sanctioned agent-UI-OUTPUT surfaces** (Pattern 1a + 1b), each respecting its own external spec.

**Pattern 1a — agent emits an MCP Apps UI surface (static HTML).** An MCP `resource` carried by `content.block`, `uri:"ui://…"`, `mimeType:"text/html;profile=mcp-app"`, `_meta.ui={resourceUri, csp?, permissions?, domain?, prefersBorder?}`. The producing tool carries the same `_meta.ui.resourceUri`. **Tool VISIBILITY is an access-control scope on the TOOL** (`AgToolDef.uiVisibility` / `tool-call.uiVisibility`), not a resource convention: `model` = in `tools/list` + model-callable; `app` = app-only (the host MUST exclude app-only tools from the agent tool list and reject cross-origin app calls). The four tool-result channels stay separate (§2.1): `content` (model) · `structuredContent` (model, structured) · `uiData` (surface/view, model-hidden) · `sideData` (app-only). `host.context` carries theme/capabilities/container dims.

**Pattern 1b — agent emits an A2UI component surface (declarative streaming).** When an agent draws components by **STREAMING**, it emits A2UI surface + component events (the §4 `ui.surface.*` / `ui.data-model` family); AgJSON carries the A2UI envelope **VERBATIM** and defines **ZERO** component schema (Layer-A: it respects A2UI, never reinvents it). The two surface-emission models are distinct: **MCP Apps** = an HTML resource block (`ui://` + `text/html;profile=mcp-app`, Pattern 1a); **A2UI** = a declarative component-tree / data-model stream carried **OPAQUELY** on `ui.surface.*` / `ui.data-model`, with the client→server data-model snapshot riding `AgMessage.messageMetadata.a2uiClientDataModel`, keyed by `surfaceId` / `catalogId`. A2UI is **NOT** routed through the `text/html` resource-block path; `catalogId` is carried **BY REFERENCE** (the catalog itself is never transmitted; the renderer resolves components against its own catalog registry). A `ui.surface.start` MAY carry `toolCallId`, linking the surface to the producing tool-call (mirrors the `ui://` `_meta.ui.resourceUri` linkage). **Render target.** The Layer-B renderer (e.g. a SilverProtocol frontend client) resolves the A2UI declarative stream against its component catalog and paints it to **static HTML** — no client-side reactive framework runs in the surface; the agent drives every update via `ui.data-model` / `ui.surface.update` pushes. (AgJSON itself defines no HTML and no render step; "static HTML" is the client's render *target*, not the wire shape.) Surfaces are **live-only** and never folded into `AgReduceResult` (§1.3, §5).

**Pattern 2 — user acts on the surface.** Component internals are out of scope. The crossing back normalizes to either (a) a client-originated `tool-result` (`AgInput.kind:"tool-result"`) or an `AgSurfaceInteraction` (`AgInput.kind:"resume"`, `uiActions[]`) correlated by `toolCallId`/`surfaceId`, or (b) an injected user message. For an A2UI surface, a user click normalizes to an `AgA2uiSurfaceAction` carrying the A2UI-frozen `name` + `sourceComponentId` (A2UI arbitrary action names) and, when `wantResponse`, an `actionId`. The **A2UI `action.context`** (the resolved dynamic data-bindings the user's action carried) is the first-class `AgA2uiSurfaceAction.context` field; the A2UI `sourceComponentId` is the first-class `sourceComponentId` field; the A2UI `action.timestamp` is the first-class `timestamp` field (no longer the old `_meta` carrier). **MCP Apps `ui/message`** routes to the injected-user-message path. **MCP Apps `ui/update-model-context`** rides an `AgMcpAppViewMessage` (`method:"ui/update-model-context"`) carrying `params:{ content?: AgBlock[]; structuredContent?: unknown }` with **last-write-wins, deferred-to-the-next-user-turn** semantics; it is NOT a message follow-up. The three core-MCP view→host messages every MCP view shares — `tools/call`, `resources/read`, `notifications/message` — are HOST-MEDIATED plumbing, NOT forwardable AgJSON surface interactions: the host serves them directly and none crosses the wire as an `AgMcpAppViewMessage`; a view-initiated `tools/call` enters AgJSON only as its resulting client-originated tool-result (`AgInput.kind:"tool-result"`, correlated by `toolCallId`).

**Pattern 3 — form.** Output `hitl.ask {kind:"form", message, schema?}`; resume with an `AgHitlAnswer {askId, status, reply}` in `AgInput.kind:"resume"` `answers[]`. The status set (`resolved`/`declined`/`cancelled`) preserves the MCP 3-action distinction (decline = explicit no; cancel = dismissed).

**Pattern 4 — approval / HITL.** See §7. The run PAUSES via `turn.done.outcome = {type:"paused", asks:[…]}` (no terminal event). Resume via `AgInput.kind:"resume"`, `answers[]`. Approve-with-edits rides `AgHitlAnswer.reply`; **denied is a distinct recorded outcome** (`tool-result.outcome:"denied"`), the human `reason` reaches the model, and `auth`/`url` are ask `kind`s. Side-effecting approvals bind to a server-issued `token` (§11 item 4 (threat model: §13.1)).

**Pattern 5 — agent↔surface RPC + shared-state.** A2UI v1.0 has **two** independent bidirectional RPC pairs: (a) **server→surface** `callFunction` → `functionResponse` maps to outbound `ui.call {surfaceId, callId, method, args?, wantResponse?, callableFrom?}` + the inbound client→server `AgA2uiFunctionResponse` (`a2uiMessage:"function-response"`, carrying `functionCallId` + `call` + `value`) which the host echoes back to the renderer as `ui.result {surfaceId, callId, method?, value?, error?}` (the normalizer copies `ui.call.method` into `ui.result.method` so the A2UI `functionResponse.call` echo round-trips with both `functionCallId` and `call`; `callableFrom:"clientOnly"` round-trips the A2UI clientOnly-rejection contract, and the reciprocal rejection rides `ui.result.error {code, message, path?}` — `path` carries an A2UI `VALIDATION_FAILED.path` JSON-Pointer); (b) **client→server** `action` (an `AgA2uiSurfaceAction` with `{name, sourceComponentId, surface:"a2ui", a2uiMessage:"action", wantResponse?, actionId?}`) → `actionResponse` maps to that `AgA2uiSurfaceAction` (input) + the output event `ui.action-result {surfaceId, actionId, value?, error?}` (`error.path` carries a `VALIDATION_FAILED` JSON-Pointer). A client→server surface-side error crosses as an `AgA2uiError` (`a2uiMessage:"error"`) carrying **exactly one of** `surfaceId` (surface-scoped error) **or** `functionCallId` (a function-call-failure error), per A2UI v1.0's Generic Error oneOf — plus `{code, message, path?}`; `path` (JSON-Pointer) is REQUIRED when `code:"VALIDATION_FAILED"`. On the `function-response` leg, the envelope's `surfaceId` is AgJSON-synthesized correlation (upstream `functionResponse` has no `surfaceId`) and is STRIPPED on reversion to the A2UI wire.

The **OpenAI Apps SDK** component→server RPCs cross as an `AgOpenAiWidgetAction` (`surface:"openai-app"`, nested on the verbatim `method`): `setWidgetState` carries the OpenAI-only `widgetState`; `callTool {name, args, callId}` is a **spec-unique surface interaction** (NOT the normalized tool-call) whose reply is the output event `ui.widget.result {surfaceId, callId, result}` correlated by `callId`; `sendFollowUpMessage {prompt, scrollToBottom?}` routes to an injected user message (`AgInput.kind:"start"`); `requestDisplayMode {mode, requestId}` is answered by `ui.display-mode` with the authoritative `granted` mode. The `callId`/`requestId` correlation ids on the OpenAI arm are AgJSON-synthesized correlation handles, not upstream OpenAI fields. `ui.display-mode` handles BOTH the OpenAI `requestDisplayMode` and the MCP Apps `ui/request-display-mode`; the **granted** mode (`granted`) is authoritative (mobile may coerce `pip`→`fullscreen`), and `surfaceId` scopes a per-surface display request. The OpenAI `widgetState` (on `AgOpenAiWidgetAction(method:"setWidgetState")` and `_meta.ui.widgetState`) is **OpenAI Apps SDK only** (`setWidgetState`); it is NOT an MCP-Apps concept and NOT a fallback A2UI carrier (F3).

A2UI **data-model** now carries **BOTH directions**: server→surface **PUSH** via the `ui.data-model` event (output), client→server snapshot via the `a2uiClientDataModel` key on `AgMessage.messageMetadata` (input, `sendDataModel` — keyed by `surfaceId`, the **sole** A2UI data-model input carrier; re-homed here from the old `AgUiAction.dataModel` field, §11 item 1). The same snapshot also rides A2A `Message.metadata` (→ `AgMessage.messageMetadata`/`metadata`/`_meta`). Any opaque shared-state echo stays on `AgInput.state` (LangGraph `values`/`updates` ride `state.snapshot`/`state.delta`, §11 item 1). MCP-Apps model-context updates ride `AgMcpAppViewMessage(method:"ui/update-model-context")`; MCP Apps never used `state.*` on the wire. (`widgetState` stays strictly OpenAI-Apps — it is NOT a fallback A2UI carrier; F3.) **Only live component-internal binding/reactivity is the named Layer-B loss.**

**Capability negotiation** is bidirectional and **in-band**: `AgClientCapabilities` (client→agent, §3) + `AgCapabilities` (agent→client, §3), carried on the first turn by the `agent.capabilities` event (§4) — an A2A AgentCard-compatible superset (streaming, pushNotifications, securitySchemes, extensions, uiCatalogs, profile).

## 7. HITL — `hitl.ask` (event) / `AgHitlAnswer` (resume payload) (one family)

The single `hitl.*` family **replaces both** the old `elicitation.request` and the old `interrupt`. There is exactly one request shape (the `hitl.ask` event) and one response shape (the `AgHitlAnswer` resume payload). There is **no** `hitl.answer` wire type — the answer flows on the INPUT side as `AgHitlAnswer` in `AgInput.kind:"resume"` `answers[]`.

**Request (an `AgEvent`):**

```ts
{ type: "hitl.ask";
  askId: string;
  kind: "approval" | "form" | "text" | "choice" | "auth" | "url";
  message?: string;
  schema?: unknown;                  // for kind:"form"
  choices?: AgChoice[];           // for kind:"choice"
  authConfig?: AgAuthConfig;      // for kind:"auth"
  url?: string;                      // for kind:"url" (out-of-band consent — see below)
  toolCallId?: string;               // approval/auth tied to a specific tool-call
  continuation?: "resume" | "turn";  // ADVISORY only — see below
  reason?: string;                   // free-form ask rationale that reaches the model — the authoritative round-trip label (LangGraph interrupt() string, ADK/Anthropic/OpenAI/Pydantic approval rationale, A2A rejected reason)
  metadata?: AgMeta;              // free-form ask bag — the ONLY lossless carrier for LangGraph interrupt(value: Any) (arbitrary dict)
  requestState?: string;             // MCP MRTR opaque server continuation blob; echoed byte-identical (see below)
  inputKey?: string;                 // MCP MRTR map key, for multiple concurrent input requests
  resumeBinding?: "id" | "positional";  // LangGraph: parallel→"id", in-node repeats→"positional"
  ordinal?: number;                  // encounter index within the owning node/task (positional binding)
  token?: string;                    // server anti-forgery
  expiresAt?: string }
```

**Response (an `AgHitlAnswer`, carried in `AgInput.kind:"resume"`, `answers[]`):**

```ts
{ askId: string;
  status: "resolved" | "declined" | "cancelled";   // preserves MCP accept/decline/cancel
  reply?: unknown;                                  // kind-typed (form fields, chosen id, text, approve-with-edits)
  reason?: string;
  ordinal?: number;                                 // for positional resume binding (LangGraph in-node)
  token?: string;
  requestState?: string }                           // MUST echo the originating ask's requestState byte-identical
```

**The pause is the turn outcome.** A within-run pause is recorded as `turn.done.outcome = { type: "paused", asks: [...] }` (the old `"interrupt"`/`"await"` outcomes are gone). The deleted `AgElicitAction` (`accept|decline|cancel`) and `interrupt.reason` are **folded into** `kind`/`status`/`reason`: the three MCP actions become the three `status` values; the old interrupt reasons become `kind` values; a free-form ask rationale (e.g. `"upload_required"`, `"policy_hold"`) is the authoritative `reason` round-trip label (`kind` stays a coarse classifier), and an arbitrary LangGraph `interrupt(value: Any)` dict rides `metadata`.

**`reason` and `metadata` carriers (re-justification).** `reason` is the human/agent-facing rationale that reaches the model on any ask: the **LangGraph `interrupt()` string case**; the **ADK `requested_auth_configs`** auth-pause rationale (alongside `AgAuthConfig` credential-exchange extras); the **Anthropic Claude Agent SDK `canUseTool` / OpenAI Agents-SDK approval / Pydantic `requires_approval`** approve-deny rationale; and the **A2A task-level `rejected`** reason. `metadata` is the only lossless outbound carrier for **LangGraph `interrupt(value: Any)`** — `interrupt()` surfaces an ARBITRARY JSON-serializable value (the pervasive HITL pattern is `interrupt({question, tool_call, ...custom keys})`); the string case maps to `reason`, a form schema to `schema`, a choice list to `choices`, but an arbitrary dict has no lossless home except this free-form bag. `AgHitlAnswer.reply` handles only the RETURN leg.

**`kind:"url"` (consent-only).** URL-mode elicitation (`{kind:"url", url, message?}`) directs the user out-of-band; data does NOT pass through the client. A `status:"resolved"` here means **consent-to-open only**, NOT that the interaction completed — completion is carried later by re-presenting `requestState` (ties to MRTR). `auth` stays the OAuth-specialized subtype; `url` covers generic out-of-band consent (API-key entry, payment).

**MCP MRTR continuation.** The 2026-01-26 MCP spec models server-initiated requests as Multi Round-Trip Requests: a paused tool call returns `resultType:"input_required"` with `inputRequests` (keyed map) + a `requestState` the client MUST echo byte-identical and MUST NOT inspect. AgJSON carries `requestState` (and the `inputKey` map key) on `hitl.ask` and back on `AgHitlAnswer`; resume is a fresh `AgInput` carrying the echoed `requestState`. `requestState` is DISTINCT from `token` (anti-forgery).

**`inputKey` (singular) vs `inputKeys` (plural) — deliberately distinct (§0.6).** These name two different things and are NOT a one-word-per-concept violation: `inputKey` (singular, on `hitl.ask` / `AgPausedAsk`, A9) is the **selected** map key — the single `inputRequests` entry this particular ask resolves, echoed in its answer. `inputKeys` (plural array, inside `pendingInput` on the `tool-result` block / tool-result input / `tool.done`, A57) is the **set of still-pending** request keys advertised on a paused `outcome:"input_required"` result. One selected key per ask vs the full pending-key set on the result — distinct concepts, distinct words.

**Resume binding (LangGraph).** LangGraph has two resume-addressing modes. **Parallel** interrupts resume via an id-keyed map (`resumeBinding:"id"`, the real interrupt id used as `askId`). **Repeated interrupts within one node** resume via a strict positional list in encounter order — and because the v1 in-node interrupt id is deterministic from the task namespace, all repeats share the same id, so AgJSON sets `resumeBinding:"positional"` + `ordinal=0,1,2…` and reconstructs LangGraph's positional resume list by sorting `answers[]` on `ordinal`. The resume payload SHAPE (scalar vs id-keyed map) is selected by the binding (§3.1), not by `answers.length`.

**A2A TaskState mapping.** A2A has 9 TaskStates. `completed`/`failed`/`canceled`/`input-required`/`auth-required` map to outcomes/asks; **task-level `rejected`** (the agent refuses the task) maps to `AgOutcome {type:"rejected"}` — DISTINCT from the tool-call `rejected` finishReason. States with no clean outcome target (`submitted`, `rejected`-at-rest, `auth-required`-at-rest, `unknown`) ride the verbatim `AgTurnRecord.taskState` / `turn.done.taskState`.

**`continuation` is advisory, never enforced.** It RECORDS the **source runtime's** model of how the answer flows back:

- `"resume"` — a within-run pause/resume (LangGraph `interrupt()`, Anthropic tool-use loop).
- `"turn"` — a between-turn next-message continuation.
- absent — either is acceptable.

Per the CORE PRINCIPLE (§0), AgJSON is a neutral translation target: it **records** the source runtime's continuation model but **never imposes** it. A client MAY satisfy any ask by either path.

`AgSurfaceInteraction` (§6) is a **separate axis** (a client→server surface interaction, not a pause) and is **kept**; it is not part of the HITL family.

## 8. Mandatory stateful normalization points

### 8.0 The Normalizer contract (normative)

A **Normalizer** is a stateful object with exactly two operations:

- `push(native) → AgEvent[]` — ingest one native framework event, return zero or more AgJSON events;
- `flush() → AgEvent[]` — end of stream; close dangling state per INV-FLUSH (§5.0).

**Lifetime.** A Normalizer instance lives for exactly **one invoke** (one framework run/stream). All its state is within-invoke: de-cumulation buffers, open-entity maps, seq/id counters. Cross-turn state (session memory, prior messages) belongs to the reducer fold, never the Normalizer. `seq` is stamped by the engine per INV-SEQ (§5.0) — facets never mint `seq`.

**Synthesis & owner backfill.** For frameworks without native lifecycle events, the Normalizer synthesizes `turn.start` before the first content event of an unopened turn (INV-TURN) and backfills every event's owning turn per INV-OWNER (explicit `turnId` → owning message via `messageId` → last-opened turn, restored to the parent when a subagent turn closes).

**Graceful degradation (normative).** A conformant Normalizer MUST NOT throw out of `push()` and MUST NOT silently drop a native event it cannot map: it emits best-effort canonical events plus either a typed `ext.<vendor>.unparsed` event carrying the raw payload, or the non-terminal `error` event. Unmappable ≠ ignorable — degradation is always visible on the wire.

**Host-binding obligations.** The host that owns the framework process has three duties this spec depends on:

1. **Thrown terminals.** A framework error that never reaches the stream (e.g. a max-turns exception thrown by the runtime) MUST be caught by the host and fed to the Normalizer as a host-terminal native event that the facet maps to `turn.error` (with the matching `code`, e.g. `max_turns`). The sentinel's shape is facet-local (the reference OpenAI facet uses a `__host_error__`-typed native event); it is a host↔facet contract, never a wire-normative AgJSON type.
2. **Cross-invoke ordering.** If a host needs a global ordinal across invokes (persistence, multiplexing), IT re-stamps or offsets `seq` outside the Normalizer (INV-SEQ). The Normalizer/reducer layer never sees a cross-invoke ordinal.
3. **One instance per invoke.** Hosts construct a fresh Normalizer per invoke and MUST call `flush()` exactly once at stream end, delivering its events to the same consumers as `push()` output.

A normalizer is **not** a pure per-event function. Implementations MUST handle (and conformance SHOULD fixture) all of:

**Applicability scoping.** Each point below binds an implementation when, and only when, it targets the framework the point names (a Claude-only normalizer is not non-conformant for skipping the Gemini points); framework-neutral points (1, 5, 10 where applicable) bind all implementations. The same per-framework scoping governs the §10 fixture list.

1. **Partial-JSON accumulation** per `toolCallId` → `tool.args.assembled`.
2. **Index→id synthesis** (Anthropic deltas carry index, not id). **Gemini** `functionCall.id` may be null on the Developer API → synthesize a stable `toolCallId` AND record the original parallel-call positional index (on `providerCallIndex` / `_meta`) so re-input can restore name+position correlation when echoing `functionResponse` parts.
3. **ADK aggregate-event suppression** (drop `partial:false` aggregate — the #1 double-render quirk).
4. **Cumulative-usage flagging** (Anthropic usage is cumulative): flag `cumulative: true` and preserve the provider's running totals **verbatim** — usage is NOT de-cumulated by the normalizer, the engine, or `reduce()` (INV-DELTA, §5.0); per-step deltas are a consumer derivation (subtract adjacent snapshots). Cumulative **content** streams (per-id text/args) ARE de-cumulated — a normalizer duty the engine discharges (INV-DELTA, §5.0).
5. **Index-keyed → id re-key** (LangChain/Pydantic delta streams).
6. **LangGraph positional intra-node pause** matching (repeated `interrupt()` in one node is positional, not id-keyed → synthesize stable `askId`s with `resumeBinding:"positional"`+`ordinal`).
7. *(Binding only for implementations that EMIT `AgMessage.content` back to Gemini `contents[]` — re-input guidance; ingest-only normalizers are exempt.)* **Gemini parallel function-call serialization** — when emitting `AgMessage.content` to Gemini `contents[]`, group ALL tool-call blocks of a step (signature on the **first** in emission order) AHEAD of ALL tool-result blocks; never interleave call/result pairs (`FC1+sig, FC2, FR1, FR2`, not `FC1, FR1, FC2, FR2`, else 400).
8. **Gemini thoughtSignature on every signed part** — preserve the signature on functionCall, **thought**, AND built-in-tool steps (google_search_call/result), not only the first functionCall; a thinking-only or grounded turn loses its signature otherwise and 400s on turn N+1.
9. **Signature_delta accumulation** — concatenate Pydantic `ThinkingPartDelta.signature_delta` fragments per part (via `reasoning.opaque.delta`) before emitting the single REPLACE `reasoning.opaque`; the assembled signature MUST be byte-identical.
10. **Tool-call identity assembly** — buffer Pydantic `tool_name_delta` and `tool_call_id_delta` per index; emit `tool.start` only once a stable `toolCallId` is available (synthesize a temporary index-keyed id if args arrive first, then rewrite to the final `toolCallId` on assembly, rewriting any buffered `tool.args.delta` keys).
11. **A2A initial-Task snapshot decomposition** — fold the first Task's `history[]` via `messages.snapshot` and seed `artifacts[]` via the artifact side-channel ONCE; subsequent `TaskArtifactUpdateEvent`s with `append:false` REPLACE the same `artifactId` (no double-seed). Structurally identical to the ADK aggregate hazard.
12. **ADK requested_auth_configs** — a MAP (functionCallId → AuthConfig) normalizes to a SET of `hitl.ask {kind:"auth", toolCallId, authConfig}` (one per entry) folded into `turn.done.outcome="paused".asks[]` (the turn does not terminate; `is_final_response()` stays true). When a framework AuthConfig exceeds the flat `AgAuthConfig`, the surplus rides `hitl.ask.metadata` (sanctioned carrier — the ask stays lossless).
13. **Anthropic absent-citations shape** — the Anthropic wire OMITS `citations` on uncited text (`undefined`, never `null`); a normalizer MUST treat absent and `null` citations identically (no citations), and MUST NOT crash or emit a citations carrier for the absent case.
14. **OpenAI deferred round-close** — the OpenAI Agents SDK wire delivers a round's `tool_output` run-item AFTER `response.completed`; a normalizer MUST defer that round's `message.end` + `turn.done` until the round's pending tool results have landed (or stream end, releasing the stashed close at flush) so a tool result never targets a sealed message or closed turn (INV-MSG, §5.0).
15. **Claude post-seal tool results (adoption)** — the Claude SDK closes the assistant message before its `tool_result` arrives; the normalizer emits `tool.done.messageId` so the result lands as a dedicated tool message via the §5 adoption row. The reference derives `messageId = "<toolCallId>:result"`; permission denials ride a dedicated carrier message (`"<turnId>:denials"`) opened and sealed BEFORE the turn closes.
16. **Claude subagent result routing** — inner tool results (`parent_tool_use_id` set) route to the SUBAGENT's turn: the normalizer maps each spawning tool-call id to the subagent turn it opened. The `subagent.start.parentTurnId` it emits MAY be a spawning-tool-call cross-ref label (`"turn_<toolCallId>"`) rather than an opened turn's id; a reducer MUST tolerate an unopened `parentTurnId` (the subagent turn's `threadId` falls back to the fold's root `threadId`, §1.2) and MUST NOT fabricate a turn record for the label.
17. **Interruption terminals are never success** — a normalizer whose native stream signals interruption (e.g. ADK `interrupted`) closes that turn with `turn.abort` exactly once and MUST NOT later emit a success `turn.done` for it; stream truncation without any terminal is closed at flush per INV-FLUSH (§5.0).
18. **ADK requested_tool_confirmations** — the sibling MAP (functionCallId → confirmation) normalizes identically: one `hitl.ask {kind:"approval", toolCallId, …}` per entry, folded into the paused close's `asks[]`.
19. **Claude refusal-fallback retraction** — the Claude Agent SDK's model-refusal-fallback protocol (SDK ≥0.3.x: `SDKAssistantMessage.supersedes` + the system message `SDKModelRefusalFallbackMessage.retracted_message_uuids`) names previously-delivered messages by their wire-frame `uuid` — a DIFFERENT id space from the messageIds a normalizer actually emits (`m.id` for an assistant frame, `"<toolCallId>:result"` for an adopted tool-result frame per item 15). A normalizer MUST track uuid → the messageId(s) it produced and emit `message.remove` for each retracted uuid it can resolve, translated through that mapping (an unresolvable uuid is a no-op, never fabricated). Both retraction sources — `supersedes` (evict "on arrival") and the end-of-turn notice (the authoritative per-turn audit record) — MAY be processed; `message.remove` on an already-removed or unknown id is idempotent. `supersedes`'s raw uuid list MAY additionally ride as `providerMetadata` on the superseding message for audit purposes. Usage caution: the turn's cumulative usage (item 4) is NOT adjusted for the retraction — the SDK's own `result.usage`/`modelUsage` already reflects whatever billing occurred server-side; a normalizer MUST NOT invent usage subtraction for the refused leg.
20. **OpenAI built-in tool lifecycle (Shell / Apply-Patch / Computer-Use / Hosted-tool)** — `@openai/agents` (observed at 0.12.0; introducing minor between 0.2.1 and 0.12.0 not pinned down) native Shell/Apply-Patch/Computer-Use/Hosted-tool calls reuse the EXISTING `tool_called`/`tool_output` run-item names with NEW `rawItem` discriminants (`shell_call`, `apply_patch_call`, `computer_call`, `hosted_tool_call`, …) that carry no `name` field (except `hosted_tool_call`, which has one) and whose `output` shape is NOT the `function_call_result` shape — a normalizer MUST NOT route them through the generic `function_call` tool-result mapping (shape-compatible field names silently produce empty content, the orphan-`tool.done` hazard). A normalizer MUST recognize these discriminants, synthesize a `name` where the wire omits one (e.g. `"builtin:shell"`, `"builtin:computer"`), and drive a full `tool.start`/`tool.args.*`/`tool.done` lifecycle from the run-item wrapper (not the raw stream, which lacks a matching literal for at least `hosted_tool_call`). `hosted_tool_call` is a special case: OpenAI's hosted tools resolve server-side within the same turn, so `tool.start`+`tool.done` fire together from the ONE `tool_called` event — there is no paired `tool_output`. `computer_call` carries BOTH `action` (single action) and `actions` (batch array); the SDK's own runtime reads `actions` FIRST (if populated), falling back to `action` — a normalizer MUST mirror this precedence (`actions ?? action ?? {}`) to avoid silent loss of a batch-form call. `computer_call_result`'s `output` is `{type:"computer_screenshot", data}` (a base64 PNG, not text) — a normalizer MUST land it as an AgBlock `file` block (`source:{type:"base64", mediaType:"image/png", data}`) in `tool.done.content` rather than attempting the generic text-content path (same orphan-`tool.done` hazard). **Tool-search** (`tool_search_call`/`tool_search_output`, observed at 0.12.0) is a related but DISTINCT wire shape within this same family: UNLIKE the four discriminants above, it does NOT reuse `tool_called`/`tool_output` — it rides its OWN dedicated `tool_search_called`/`tool_search_output_created` run-item event names, streamed as a PAIRED call+output (mirroring shell/apply-patch/computer's pairing, not hosted-tool's single-shot collapse). A normalizer MUST still synthesize a `name` (`"builtin:tool_search"`, the wire carries none) and drive the same full lifecycle. Its correlation id is WEAKER than every other builtin's: `call_id`/`callId` are BOTH optional and nullable (vs. the others' required `callId`), and the SDK's own runtime resolves the pairing through a fallback chain (`call_id`/`callId` → a `providerData.call_id`/`providerData.callId` channel used by the SDK's built-in client-executed tool-search loader → the item's own `id` → a last-resort positional match) — a normalizer MUST mirror at least the `id`-resolvable legs of that chain and MUST NOT fabricate a correlation id for a call/output with none resolvable (degrade losslessly instead, e.g. a vendor-extension carry). The output's `tools` array is a structured retrieval LISTING (tool references/definitions), never natural-language text — a normalizer MUST land it as a structured (non-text) `tool.done.content` block rather than inventing a text rendering, and MUST preserve a zero-match (empty-array) result rather than treating it as absent content. No error discriminant exists on this wire arm — same `outcome:"ok"`-always treatment as `computer_call_result`.
21. **Claude informational notices (carry-only)** — the Claude Agent SDK's `SDKInformationalMessage` (`type:"system", subtype:"informational"`) carries genuinely conversation/UX-relevant `content`/`level`/`prevent_continuation?` (transcript notices, an explanation for why a turn halted — e.g. a Stop-hook denial) with no first-class AgJSON event today; a normalizer MUST NOT silently drop it — it MUST carry the frame losslessly via `ext.anthropic.informational{content, level, preventContinuation}` (§12's vendor-extension channel, live-only). A first-class `notice` core event covering this content is a future spec-process decision, out of scope for this item.
22. **Vendor-frame bulk carry (`ext.<vendor>.frame`)** — when a wire surface exposes MANY distinct native frame kinds that each carry genuine consumer-facing content but share NO existing AgJSON vocabulary home (e.g. the Claude Agent SDK's hook stdout/stderr, slash-command output, OAuth-flow instructions, toast notifications, file-persistence receipts, tool-use-summary prose, recalled-memory body text, a no-fallback refusal's own diagnostic fields, suggested-prompt text, mirror-sync errors, and the Task-tool background-task-progress family), a normalizer MUST NOT mint one distinct `ext.<vendor>.<key>` per frame kind (ext-vocabulary sprawl) NOR silently drop them. It MUST carry each losslessly under ONE uniform key, `ext.<vendor>.frame{kind, frame}`: `kind` is the frame's own discriminating subtype/type string (e.g. Claude's `msg.subtype` or `msg.type`), and `frame` is the VERBATIM native message (no field-by-field reinterpretation — the whole frame rides opaquely, live-only per §12). A frame that DOES map onto existing AgJSON vocabulary (e.g. Claude's standalone `permission_denied` notice enriching the already-handled `permission_denials[]` aggregate's `tool.done`, §8 item 15) is wired to that existing home instead and is NOT swept into this bulk carry — this item covers only the residual arms with no existing home, studied and rejected as candidates for one (e.g. a Task-tool background-task frame is NOT folded into `subagent.start`/`subagent.done` when doing so would duplicate content the nested subagent's own tool-call stream already conveys, the M22 double-fold hazard, or when the correlating id is optional/absent on some instances of the frame).
23. **ADK unmapped Part/Event fields (`provider-raw` carry)** — Gemini `Part` fields with no dedicated AgJSON handling (`mediaResolution`, `videoMetadata`, `toolCall`, `toolResponse`, `partMetadata` — `videoMetadata` normally rides ALONGSIDE an already-handled `inlineData`/`fileData` part, per genai's own doc, so the check MUST run unconditionally rather than only as an else-fallback) and the OPTIONAL ADK `Event`/`LlmResponse` fields `candidateIndex`/`branch` MUST NOT be silently dropped: a normalizer carries them via the existing `provider-raw` content block (mirroring the ADK facet's own pre-existing `actions`/`citationMetadata`/`customMetadata` unmapped-field carry) rather than discarding them when no dedicated AgJSON route exists (fixture-drift ratchet finding). This item does NOT extend to `Event`'s REQUIRED (non-optional) fields `author`/`timestamp`: both are present on every native event, so folding them into the same generic carry would emit a `provider-raw` block on every single event rather than an occasional one — a normalizer MAY leave them disposed `silently-dropped` pending a dedicated, non-noisy home (a future spec-process decision) instead.

## 9. Profiles

The profile split resolves the CORE/text-path question explicitly: **CORE has exactly one text path** and a tool-result with `content`+`outcome` only.

- **CORE**
  - Events: `turn.start|done|error|abort`, the non-terminal `error`, `message.start|end`, `text.start|delta|end`, `content.block`, `tool.start|args.delta|args.assembled|done`, `message.remove`, and `messages.snapshot` (both REQUIRED by CORE's own reconnect story — §5, §10 item 2).
  - Blocks: the `AgBlock` subset `text | image | tool-call | tool-result`. In CORE, `content.block.block.type` MUST be one of `{text, image, tool-call, tool-result}`; a CORE agent emitting any other block type is operating in EXTENDED/ADVANCED.
  - Plus `reduce()`.
  - **CORE `tool-result` carries `content` + `outcome` ONLY.** `structuredContent`, `uiData`, and `sideData` are ADVANCED and **MUST NOT be silently dropped** by a CORE implementation — it MUST either refuse the message or pass the extra channels through untouched (refuse-or-passthrough).
  - **One text path** (no `text.chunk`/alternate forms in CORE).

- **EXTENDED** — adds `reasoning.*` (incl. `reasoning.opaque`, `reasoning.opaque.delta`), citations (`AgCitation` on `text` blocks), `step.*`, `subagent.*`, the `source` event (the binding target for offset citations via `sourceIds`→`source.sourceId`), `handoff`, the `hitl.*` family, `usage` (`AgUsage`), the `finishReason` superset, `safety[]`, the `memory.write` side-channel, and `guardrail.result`; and the `compaction` / `search-result` / `code` / `code-result` / `document` / `file` / `audio` / `data` / `provider-raw` / `resource` / `resource-link` blocks (the remaining 12 of the 16 `AgBlock` kinds not in CORE's 4 — matching `agjson.ts`'s CORE/EXTENDED block-kind comment; ADVANCED adds no additional block kinds).

- **ADVANCED** — adds `state.snapshot|delta`, `artifact.*`, `ui.call|result|action-result|widget.result|display-mode|surface.start|surface.update|surface.end|data-model`, the input-side surface-interaction family (`AgSurfaceInteraction`: `AgA2uiSurfaceAction` / `AgA2uiFunctionResponse` / `AgA2uiError` / `AgMcpAppViewMessage` / `AgOpenAiWidgetAction`, carried by `resume.uiActions[]` — the input mate of the ADVANCED `ui.*` family), `agent.capabilities`, `host.context`, `display.required`, `message.metadata`, `prompt.blocked`, and the **`uiData` + `sideData` tool-result channels** (§2.1). (The four A2UI surface-stream events `ui.surface.start|update|end` + `ui.data-model`, plus the OpenAI `ui.widget.result` reply, are ADVANCED-profile, live-only / non-folding.) ADVANCED adds **no additional `AgBlock` kinds** — CORE's 4 plus EXTENDED's 12 already cover all 16 (§9 EXTENDED, above).

`ext.<vendor>.<key>` is **profile-agnostic** (allowed in any profile, live-only by default). A client/agent advertises its profile via capabilities (`AgCapabilities.profile`); CORE clients ignore EXTENDED/ADVANCED events (the unknown-type-ignore rule, §0.2).

## 10. Conformance

A conformant normalizer ships fixtures asserting:

*(Items asserting `emit→reduce→re-input` round-trips — 4, 13, 15, 18 — bind only implementations that ship an emit/re-input surface (§8 item 7 scoping); ingest-only normalizers record them N/A. Framework-specific items follow §8's applicability scoping.)*

1. **`reduce()` invariant** — `stream → reduce == AgReduceResult` for every block kind (the full §5 folding table), including **block insertion order** for interleaved-block-kind turns.
2. **Reconnect** — `stream-with-gap + messages.snapshot → reduce == AgReduceResult`; a **forward `seq` gap** triggers snapshot-resync; a backward `seq` jump (a new invoke's 0-restart) folds normally (INV-SEQ). A gap spanning `artifact.*` / `handoff` / `prompt.blocked` / `paused turn.done` round-trips via the full-state snapshot. A gap mid-`tool.args.delta` and mid-`text.delta` asserts **no double-apply** after the snapshot (transient state cleared).
3. **Tool-result routing matrix** — `content`→model; `structuredContent`→model (base MCP); **`uiData`→surface, NOT model** (MCP Apps structuredContent); `sideData`→app-only. (`model-readable? model-structured form? surface/view? app-only?`.)
4. **Gemini signature loop** — the `thoughtSignature` rides the correct entity and survives `emit → reduce → re-input` for (a) the first `tool-call` part (signature on `tool-call.signature` / `tool.args.assembled.signature`), (b) a **thinking-only** turn (signature on the reasoning block's `opaque`, message/reasoning-block-targeted — NOT a tool-call target), and (c) a **Google-Search-grounded** turn (signature on the reasoning block's `opaque`); also the **OpenAI stateless reasoning loop** (`rs_` itemId + `encrypted_content` + interleaved `fc_` items survive). Echo or turn N+1 is a hard 400.
5. **Source round-trips** — MCP base64 and Anthropic url/file both survive (`AgSource` merge).
6. **Mandatory display** — a `display.required` event is not dropped (ToS).
7. **`safety_blocked` category** — any `finishReason:"safety_blocked"` (or `prompt.blocked`) SHOULD carry a populated `safety[].category` when the source provides it so the collapsed reason is recoverable; when the source emits only a bare content-filter signal with no category, `safety_blocked` MAY be emitted with empty `safety[]` (§4).
8. **Cumulative-usage verbatim fold** — a cumulative Anthropic usage stream folds with the provider's running totals preserved verbatim and `cumulative: true` intact; nothing in the pipeline subtracts (INV-DELTA).
9. **ADK aggregate suppression** — a `partial:false` aggregate reduces without double-render.
10. **Index→id re-key** — a LangChain/Pydantic index-keyed delta stream reduces to id-keyed blocks.
11. **LangGraph positional pause** — two `interrupt()`s in one node yield two stable distinct `askId`s (via `resumeBinding:"positional"`/`ordinal`) that survive resume; the resume payload SHAPE (scalar vs map) matches the binding.
12. **Interleaved subagent + parent** — an interleaved subagent+parent stream folds to the correct per-turn messages (each block routed by its event `turnId`).
13. **Replay-blob round-trips** — Anthropic reasoning signature/redacted blobs survive byte-identical on the reasoning block's `opaque` carrier (`kind:"signature"|"redacted"` — §5 `reasoning.opaque` row); Anthropic web-search `encrypted_content` (`search-result.opaque`) and `encrypted_index` round-trip; Pydantic `CompactionPart` round-trips; bare-key `_meta` (`timestamp`, `traceparent`) and a flat A2A/Vercel `metadata` key survive `emit→reduce→re-input` unchanged.
14. **A2UI RPC round-trips (per-arm)** — assert on the A2UI ARM specifically: the server `callFunction`→ the client `AgA2uiFunctionResponse` (`a2uiMessage:"function-response"`) round-trips BOTH `functionCallId` AND `call` (and the echoed `ui.result.method`); an `AgA2uiSurfaceAction` (`a2uiMessage:"action"`) carries NO OpenAI `widgetState` (the un-merge keeps OpenAI-only fields off the A2UI arm); a `wantResponse:true` action (with its `actionId`) → `ui.action-result`; the `sendDataModel` per-surface data-model snapshot round-trips on `AgMessage.messageMetadata.a2uiClientDataModel` (NOT on a per-action field); `action.context` resolved bindings survive on `AgA2uiSurfaceAction.context`; an `AgA2uiError` round-trips `code`/`message`/`path` in BOTH shapes — surface-scoped (`surfaceId`, no `functionCallId`) and function-call-failure (`functionCallId`, no `surfaceId`) — and a both-fields or neither-fields shape is REJECTED (the `VALIDATION_FAILED.path` JSON-Pointer reaches `ui.result.error.path` / `ui.action-result.error.path`); and the OpenAI `AgOpenAiWidgetAction(method:"callTool", callId)` reply round-trips as `ui.widget.result {callId, result}`.
15. **Gemini parallel ordering** — a 2-call parallel turn asserts the grouped `FC1,FC2,FR1,FR2` ordering survives `emit→reduce→re-input`.
16. **A2A initial-Task** — an initial Task carrying an artifact + a later artifact-update for the same `artifactId` yields exactly ONE artifact.
17. **Signature reassembly** — a 2-fragment `reasoning.opaque.delta` signature reassembles byte-identically; an id-fragmented tool call assembles to a single stable `toolCallId`.
18. **MCP MRTR** — `requestState` survives `emit→reduce→re-input` byte-identical; resume is a fresh `AgInput` carrying the echoed `requestState`.
19. **A2UI component streaming** — a `createSurface(components, dataModel)` + `updateComponents` + `updateDataModel` + `deleteSurface` sequence round-trips through `ui.surface.*` / `ui.data-model` with the opaque `components`/`dataModel`/`value` payloads byte-identical (Layer-A: no component-schema interpretation); the streamed adjacency-list and the `id:"root"` survive verbatim; `catalogId` round-trips by reference.
20. **Malformed input at a trust boundary** — a schema-invalid event is rejected before folding (typed error to the caller); the reducer's fold state and resync condition are unaffected by the rejected event.

## 11. Resolved decisions (provisional — see design record)

The forks; the spec leans to the smaller surface. Marked provisional — may change before v1 freeze. **Items resolved by the feasibility audit are tagged [REVISED]; items resolved in favor of the MCP-Apps + A2UI UI-output model are tagged [A2UI].**

1. **[A2UI] Shared state stays opaque both directions** — no neutral bound-value channel yet. LangGraph `values`/`updates` stream modes ride `state.snapshot`/`state.delta` (output); the input-direction echo rides `AgInput.state` (all `unknown`). The A2UI per-surface data-model snapshot IS carried INPUT (the `a2uiClientDataModel` key on `AgMessage.messageMetadata`, re-homed from the old `AgUiAction.dataModel` field) and the server→surface push IS carried OUTPUT (`ui.data-model`); only live component-internal reactivity is the Layer-B loss.
2. **[REVISED] Tool-result channels = 4, one consumer each** — `content` (model) · `structuredContent` (model, structured; always model-facing, NO audience flag) · `uiData` (surface/view, model-hidden) · `sideData` (app-only), with the §10 routing fixture. The old `artifact` tool-result channel is **renamed `sideData`**; the word `artifact` is now reserved for the A2A streamed entity (`AgArtifact` / `artifact.*`). The old `modelStructured`-collapse rationale is gone — the channel encodes audience.
3. **Async tools = minimal flags** — `more` / `willContinue` / `scheduling` (`when_idle`/`preempt`/`silent`) only (no separate async-task lifecycle). [REVISED: the scheduling value `interrupt` is renamed `preempt` to keep the purged word out of the vocabulary.]
4. **[REVISED] Approval tokens are binding-gated** — RECOMMENDED in the neutral spec; a **MUST in guuey's binding** for side-effecting (state-changing) HITL approvals. (Previously mislabeled "profile-gated"; no §9 profile gates tokens.)
5. **Capabilities are in-band** — `AgClientCapabilities` (client→agent) + `AgCapabilities` (agent→client, now a defined interface), carried on the first turn via the `agent.capabilities` event.
6. **[NEW] Identity/lifecycle backbone** — `message.start`/`message.end` partition the stream into messages; the event base carries `turnId`/`messageId`; `turnId` is dual-use (own-id + owning-turn cross-ref), `parentTurnId` is the subagent-parent link only; `subagent.start` is the sole nested-turn opener; turn-open is idempotent on `turnId`. `branch` was removed (re-addable additively if regenerate/edit-forks are specced).
7. **[A2UI] Agent-UI output = MCP Apps + A2UI** — the two sanctioned agent-UI-OUTPUT paths are **MCP Apps** (static-HTML document surface, `ui://` + `text/html;profile=mcp-app` resource block) and **A2UI v1.0** (declarative component-tree + data-model stream). A2UI is the first-class declarative path: `ui.surface.start|update|end` + `ui.data-model` carry A2UI `createSurface`/`updateComponents`/`deleteSurface`/`updateDataModel` Layer-A-opaquely, keyed by `surfaceId`/`catalogId`. Two general-purpose constructs (`state.snapshot`/`state.delta`; `hitl.ask.metadata`/`AgPausedAsk.metadata`) are anchored on LangGraph (`values`/`updates` stream modes; `interrupt(value: Any)`). Surfaces are live-only (not in §1.3).
8. **[NEW] Surface-interaction un-merge** — the old single merged `AgUiAction` is replaced by a shared `AgSurfaceEnvelope` (correlation: `surface` discriminant + `surfaceId`/`toolCallId`/`turnId`/`threadId`/`_meta`) + five per-spec-faithful constructs forming `AgSurfaceInteraction`: `AgA2uiSurfaceAction` / `AgA2uiFunctionResponse` / `AgA2uiError` (the three A2UI client→server legs, narrowed by the inner `a2uiMessage` discriminant `action`/`function-response`/`error`) (the `error` leg is upstream-faithful: exactly-one-of `surfaceId` | `functionCallId`), `AgMcpAppViewMessage` (MCP Apps view→host RPCs, nested on the verbatim JSON-RPC `method`), and `AgOpenAiWidgetAction` (OpenAI Apps SDK component→server RPCs, nested on `method`). `surface` carries the explicit discriminant `a2ui | mcp-app | openai-app` (reversing the old positional F8 identification). `callTool`/`setWidgetState` stay spec-unique surface interactions, NOT the normalized tool-call. The A2UI `action.timestamp`/`action.context` become first-class fields on the A2UI arm (the old `_meta`-carrier bug is fixed); the client data-model snapshot is re-homed to `AgMessage.messageMetadata.a2uiClientDataModel` (decision 1). Two new output legs accompany the un-merge: `ui.widget.result {surfaceId, callId, result}` (the OpenAI `callTool` reply) and `error.path?` (JSON-Pointer) on `ui.result` / `ui.action-result` for the A2UI `VALIDATION_FAILED.path`. The un-merge is INPUT-surface-layer-only + these 2 small output legs; the isomorphic CORE is untouched.

## 12. Extensibility & versioning

`protocol:"agjson"`, `version` semver — **minor = additive-only**. Extension mechanisms:

Additive-minor only works if consumers honor §0.2's ignore-unknown rule: a validating CONSUMER MUST use a lenient parse-known-else-skip mode; strict full-schema validation is a PRODUCER-side conformance check only.

**Version negotiation.** The current spec version is `1.0.0-draft.1`. Emitters MUST populate `AgInputEnvelope.version` (and SHOULD surface the same value out-of-band) with the spec version they implement. A consumer MUST reject an envelope whose `version` differs in MAJOR component, and SHOULD accept any same-major version, ignoring unknown additive fields per §0.2's consumer-ingestion posture. Behavior on prerelease tags (`-draft.*`) is same-major acceptance.

**Vendor namespace ownership.** The `<vendor>` segment of `ext.<vendor>.<key>` MUST be a namespace the emitter owns (RECOMMENDED: an npm scope or reversed domain the vendor controls). Implementations MUST NOT emit under a segment they do not own. Reserved segments (claimed by this spec + the reference SDK): `anthropic`, `google`, `openai`, `langgraph`. Collisions resolve to this list. RECOMMENDED bulk-carry shape: when a vendor's wire exposes many distinct frame kinds with no existing AgJSON vocabulary home, prefer the single uniform key `ext.<vendor>.frame{kind, frame}` (§8 item 22) over minting one distinct `<key>` per frame kind.

**Payload embedding.** An `ext.<vendor>.<key>` payload is spread into the event object; a NON-object payload rides under the fixed key `value`; payload keys colliding with the engine-owned envelope (`seq`/`type`/`id`/`turnId`/`messageId`/`parentId`/`_meta`) are relocated verbatim under `shadowed` — the channel never drops payload bytes; a payload's own `shadowed` key relocates into that bag (`shadowed.shadowed`) when collisions force the wrapper.

- **Namespaced typed event types `ext.<vendor>.<key>`** — NOT an `x-` prefix (`x-` is RFC-6648-deprecated). These fold only if a vendor profile defines folding; otherwise live-only. They are AgJSON's OWN event namespace, distinct from the foreign `extensions?: string[]` (A2A active-extension URIs) carried on `AgMessage`/`AgArtifact` (§0.5). **LangGraph stream modes map as: `values`→`state.snapshot`, `updates`→`state.delta` (node-keyed merge), `messages`→text/tool deltas, `custom`→`ext.langgraph.custom` (live-only, non-folding), and `checkpoints`/`tasks`/`debug`→`ext.langgraph.checkpoint`/`ext.langgraph.task`/`ext.langgraph.debug` (live-only, non-folding; task errors MAY surface as the non-terminal `error` event).** This closes the LangGraph naming gap so every one of the 7 stream modes has a normative destination.
- **`data` blocks by `name`** — typed payloads addressed by name (e.g. a streamed status panel as `name:"status"`, reconciled by `id`).
- **`providerMetadata`** (`AgProviderMeta`, branded nominally distinct from `AgMeta`) — **replay-load-bearing**: values that must round-trip to the provider (OpenAI `itemId`, Gemini tool-call signatures, etc.; the Anthropic reasoning signature rides the reasoning block's `opaque` carrier — §2). The brand keeps it from being confused with host-only annotations. The provider-replay channel imposes **NO key namespacing** — keys echo VERBATIM (flat or otherwise); `providerDetails?` is the flat provider-keyed replay dict (Pydantic `provider_details`) where a brand-typed bag is inconvenient (and is a convenience alias on the reasoning block, not the only home — see §2).
- **`_meta`** (`AgMeta`, now `Record<string, unknown>`) — host-only side metadata; namespacing is a RECOMMENDED convention (§0.4/§2), not a wire-type constraint, so flat foreign keys (A2A free-form, Vercel `createdAt`/`totalTokens`, OpenTelemetry `traceparent`/`tracestate`/`baggage`, Apps SDK component `_meta`) round-trip unchanged.

There is **no in-band free-form `custom`/`raw` hole** in the normalized vocabulary; the only escapes are the typed `provider-raw` block (lossless last resort) and a host-level bypass capability (a host relaying the framework's native format verbatim, outside AgJSON entirely — out of scope for this spec).

## 13. Security Considerations

AgJSON is a transport for model-generated, framework-generated, and user-generated content crossing trust boundaries. This section states each party's duties (RFC 3552 shape). Nothing here licenses an SDK to mutate payloads — byte-identical echoes are replay-load-bearing (§3.1, §12).

### 13.1 Approval tokens (`hitl.ask.token`)

The side-effecting-approval `token` (§7, §11 item 4) is an anti-forgery credential: the AGENT HOST mints it, scopes it to one `askId`, and MUST validate on resume that (a) the token matches the ask, (b) it is unexpired (`expiresAt`), and (c) it is single-use (replay of a consumed token is rejected). Clients treat the token as opaque and MUST NOT log or persist it beyond the resume exchange. A binding that makes tokens mandatory (see §11 item 4) inherits these validation semantics.

### 13.2 Opaque replay blobs

`reasoning.opaque` values, `providerMetadata`, MRTR `requestState`, and encrypted/redacted provider blobs are provider-bound secrets in transit: implementations MUST echo them byte-identical (§3.1), MUST NOT attempt to decode or inspect them, SHOULD NOT log them, and SHOULD NOT persist them unencrypted at rest. They may embed provider-side keys or user content in sealed form.

### 13.3 UI payloads (MCP Apps HTML, A2UI trees, OpenAI widgets)

Surface payloads are **model-controlled executable content**. The Layer-B renderer — never the Normalizer or `reduce()` — owns sandboxing: MCP Apps `text/html` resources MUST render in an origin-isolated frame honoring the resource's `_meta.ui.csp` when present (the host enforces the CSP; AgJSON only carries it); A2UI component trees resolve against the client's own catalog only (`catalogId` is by-reference — a payload can never inject components the catalog lacks); `display.required` HTML carries the same ToS-render duty AND the same sandboxing duty. A renderer MUST treat all surface payloads as untrusted (XSS-bearing) input.

**Duty bearer.** The `display.required` carriage MUSTs (never dropped; folded to `AgTurnRecord.displayRequired`) bind the normalizer and reducer. A Layer-B binding that DISPLAYS grounded answers MUST render the turn's `displayRequired` records (the provider-ToS render duty); non-rendering consumers (folds, evals, pipelines) carry the carriage duty only and are not in breach by not rendering.

### 13.4 URLs

`AgCitation`/`source` URLs, `hitl.ask {kind:"url"}` targets, and any model-supplied link MUST be scheme-validated by the consumer before navigation or rendering as a hyperlink: `https:`/`http:` (and application-registered schemes a host explicitly allows); `javascript:`, `data:`, and `vbscript:` MUST be rejected.

### 13.5 Push-notification credentials (SSRF)

`AgRunConfig.pushNotification {url, token?, auth?}` instructs an agent host to POST to a client-supplied URL bearing client-supplied credentials — the classic SSRF + credential-exfiltration shape (inherited from A2A, whose security guidance applies). A host honoring it MUST validate the URL against an allowlist or egress policy (no internal/link-local targets), MUST NOT attach credentials beyond those supplied in the config, and SHOULD verify ownership of the callback endpoint (e.g. a challenge round-trip) before delivering content.

### 13.6 Untrusted-source marker

`provider-raw` blocks, `ext.<vendor>.<key>` payloads, and `_meta` values carry model- or framework-controlled bytes end to end by design (§12). Consumers MUST treat them as untrusted input: never `eval`, never render as HTML, never interpolate into shell/SQL/DOM sinks without the same escaping applied to any external input.

## 14. References

Normative external surfaces are pinned to the revisions below; "verbatim" clauses in this spec are relative to these pins.

- **[MCP + MCP Apps]** Model Context Protocol, revision **2026-01-26**, incl. the Apps extension — https://modelcontextprotocol.io/specification/2026-01-26
- **[A2UI]** A2UI **v1.0** — https://github.com/google/A2UI (spec + `client_to_server.json` schema at the v1.0 tag)
- **[A2A]** Agent2Agent protocol **v0.3.0** — https://a2a-protocol.org/v0.3.0/specification/
- **[OpenAI Apps]** OpenAI Apps SDK reference, snapshot **2026-06** — https://developers.openai.com/apps-sdk (DisplayMode, `window.openai` surface; unversioned upstream — pinned by snapshot date)
- **[LangGraph]** LangGraph **v1** stream modes — https://langchain-ai.github.io/langgraph/
- **[RFC 2119] / [RFC 8174]** BCP 14 requirement keywords.
- **[RFC 6648]** deprecating `x-` prefixes (§12 `ext.` namespace).
- **[RFC 6902]** JSON Patch (`state.delta`, `memory.write.patch`).
- **[RFC 8785]** JSON Canonicalization Scheme (non-normative byte-comparison annex, §5.0 INV-FOLD).
- **[RFC 3552]** security-considerations guidance (§13).

_(Publish gate: every URL above must resolve at first publish; the OpenAI Apps snapshot date is re-verified each release.)_
