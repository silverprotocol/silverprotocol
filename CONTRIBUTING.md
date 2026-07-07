# Contributing to Silver Protocol

Thanks for your interest in AgJSON.

## Where things go

- **This repo (`silverprotocol/AgJSON`)** — the protocol itself: the
  spec ([`SPEC.md`](./SPEC.md)), event vocabulary, framework-mapping questions,
  and proposals for new event types or blocks. Open an **issue** or a
  **discussion** here for anything protocol-level.
- **An SDK repo** (e.g. [`typescript-sdk`](https://github.com/silverprotocol/typescript-sdk)) —
  implementation bugs, packaging, and PRs for that specific SDK go to that repo.

## Proposing a change to the spec

1. Open an issue describing the gap, ideally with a concrete framework wire
   example that AgJSON can't currently represent losslessly.
2. AgJSON's guiding rule is that it **records what frameworks do; it never
   imposes a framework's runtime model**. Proposals that add a neutral,
   evidence-backed representation of a real framework behaviour are the most
   likely to land. New surface for its own sake is not.
3. The wire format is **additive-minor**: unknown event types and fields are
   always safe to ignore, so v1.0 clients keep working as the spec grows.

## Adding a normalizer for a new framework or language

Normalizers are community-contributable. A normalizer implements the stateful
`push(native) → AgEvent[]` / `flush() → AgEvent[]` contract (spec §8). Start by
opening an issue so we can point you at the reference implementation and the
conformance fixtures.

## Maintainers

Silver Protocol and the AgJSON spec are maintained by
[@wanseob](https://github.com/wanseob).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](./LICENSE).
