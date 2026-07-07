/**
 * The same fold as a React component — "bring your own UI in a few lines."
 *
 * AgJSON ships no components and no renderer. This is *your* code: swap in your
 * design system, virtualize the list, stream it in — whatever. The only AgJSON
 * dependency is `@silverprotocol/core` for the types and the `reduce()` fold.
 */
import { ingestAgEvents, Reducer, type AgBlock } from "@silverprotocol/core";

function Block({ b }: { b: AgBlock }) {
  switch (b.type) {
    case "text":
      return <span>{b.text}</span>;
    case "reasoning":
      return <em style={{ opacity: 0.6 }}>{b.text}</em>;
    case "tool-call":
      return <code>→ {b.name}({JSON.stringify(b.input)})</code>;
    case "tool-result":
      return (
        <code>
          ← [{b.outcome ?? "ok"}]{" "}
          {b.content.map((c, i) => <Block key={i} b={c} />)}
        </code>
      );
    default:
      return <span>[{b.type}]</span>;
  }
}

/** Feed it an AgJSON event stream — any framework's normalizer output. */
export function Chat({ wire }: { wire: unknown[] }) {
  const reducer = new Reducer();
  for (const ev of ingestAgEvents(wire as Parameters<typeof ingestAgEvents>[0])) {
    reducer.push(ev);
  }
  const { messages } = reducer.result();

  return (
    <div className="agjson-chat">
      {messages.map((m) => (
        <p key={m.id}>
          <strong>{m.role}:</strong>{" "}
          {m.content.map((b, i) => <Block key={i} b={b} />)}
        </p>
      ))}
    </div>
  );
}
