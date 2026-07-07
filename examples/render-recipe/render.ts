/**
 * Render recipe — AgJSON → your UI, framework-agnostic.
 *
 * AgJSON's job ends at `reduce()`: it hands you a plain object graph
 * (messages, turns, artifacts). Rendering is entirely yours. This file is a
 * *recipe*, not a package — ~40 lines, one dependency (`@silverprotocol/core`),
 * and no AgJSON UI layer to adopt. Copy it, swap the `render*` fns for your own,
 * and you have a client.
 *
 *   Run it:  npm i @silverprotocol/core && npx tsx render.ts
 */
import { readFileSync } from "node:fs";
import {
  ingestAgEvents,
  Reducer,
  type AgMessage,
  type AgBlock,
} from "@silverprotocol/core";

// 1 · An AgJSON event stream. Here: the Claude normalizer's output from the
//     convergence-echo fixture. In your app this is whatever arrives on the wire
//     — and its shape is identical no matter which framework produced it.
const wire = JSON.parse(
  readFileSync(
    new URL("../convergence-echo/claude.agjson.json", import.meta.url),
    "utf8",
  ),
) as Parameters<typeof ingestAgEvents>[0];

// 2 · Validate + fold into the normative object graph. This is the whole
//     consumer-side surface of the SDK.
const events = ingestAgEvents(wire); // parse-known-else-skip; never throws
const reducer = new Reducer();
for (const ev of events) reducer.push(ev);
const { messages } = reducer.result(); // AgMessage[] — the thing you render

// 3 · Render. AgJSON owns NONE of this — it's just a fold over typed content
//     blocks. Return strings here; return JSX / DOM / anything in your app.
function renderBlock(b: AgBlock): string {
  switch (b.type) {
    case "text":
      return b.text;
    case "reasoning":
      return b.text ? `\n  💭 ${b.text}` : "";
    case "tool-call":
      return `\n  → ${b.name}(${JSON.stringify(b.input)})`;
    case "tool-result":
      return `\n  ← [${b.outcome ?? "ok"}] ${b.content.map(renderBlock).join("")}`;
    case "image":
      return "[image]";
    default:
      return `[${b.type}]`; // audio · file · code · resource · …
  }
}

const renderMessage = (m: AgMessage): string =>
  `${m.role}: ${m.content.map(renderBlock).join("")}`;

for (const m of messages) console.log(renderMessage(m));

// Swap the fixture for ../convergence-echo/openai.agjson.json — same code,
// same output shape, a different framework. That's "write your client once."
