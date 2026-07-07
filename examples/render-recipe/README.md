# render-recipe

**AgJSON hands you data; the UI is yours.** This is the other half of "write
your client once" — a *recipe*, not a package. There is no `@silverprotocol/react`,
no component library, no renderer to adopt — deliberately. AgJSON is the
transport; rendering stays entirely on your side. Copy these files and make
them yours.

| File | What it shows |
| --- | --- |
| [`render.ts`](./render.ts) | Framework-agnostic: `ingestAgEvents` → `Reducer` → `messages`, folded to plain strings. ~40 lines, runnable. |
| [`react.tsx`](./react.tsx) | The same fold as a ~25-line React component. |

## The whole idea

The consumer side of AgJSON is two calls:

```ts
const reducer = new Reducer();
for (const ev of ingestAgEvents(wire)) reducer.push(ev);
const { messages, turns, artifacts } = reducer.result();
```

`reduce()` gives you a normative object graph — `messages` (each an ordered list
of typed content blocks: `text`, `tool-call`, `tool-result`, `reasoning`, …),
plus `turns`, `artifacts`, and `memory`. Walk those blocks with whatever UI you
already have.

Because every framework's normalizer emits the **same event vocabulary**, this
render code is identical whether the stream came from Claude, OpenAI, or Google
ADK. That's the point — the framework is swappable, the client isn't rewritten.

## Run it

```sh
npm install @silverprotocol/core
npx tsx render.ts
```

It folds the Claude normalizer's `convergence-echo` output and prints the
messages. Point it at [`../convergence-echo/openai.agjson.json`](../convergence-echo)
instead — same code, same output shape, a different framework.

> Why a recipe and not a package? AgJSON's whole design is to own the wire
> format and nothing above it. Shipping a UI would make it an interaction
> framework; keeping rendering yours is what keeps it a neutral transport you
> can drop into any stack. If a community client SDK would help you, that's
> welcome — [open an issue](https://github.com/silverprotocol/AgJSON/issues).
