export type Profile = "review" | "security" | "performance" | "reliability" | "architecture";

export const profiles: Record<Profile, { summary: string; focus: string; guidance: string[] }> = {
  review: {
    summary: "Correctness, test gaps, regression risk, simplification",
    focus:
      "Correctness, error handling, API misuse, test gaps, regression risk, maintainability, and behavior-preserving simplification.",
    guidance: [
      "Prioritize correctness and regression risks, then test gaps, maintainability problems, and safe simplifications.",
      "Find behavior-preserving ways to make code easier to understand: delete, inline, flatten, or reduce branching and indirection.",
      "Recommend DRY only for duplicated knowledge that would need to change together; ignore merely similar-looking code.",
      "Reject style-only rewrites, speculative cleanups, and abstractions that increase cognitive load.",
    ],
  },
  security: {
    summary: "Trust boundaries, injection, secrets, data exposure",
    focus:
      "Defensive review of trust boundaries, authn/authz, injection, secrets, unsafe parsing, and data exposure.",
    guidance: [
      "Trace untrusted input from entry points to sinks: queries, shells, file paths, templates, deserializers, redirects.",
      "Check authentication and authorization on every externally reachable operation, not only the obvious ones.",
      "Look for secrets in source, logs, error messages, and client-visible responses.",
      "Reject findings that need an attacker position the code does not expose.",
    ],
  },
  performance: {
    summary: "Complexity, I/O hot spots, resource use (static)",
    focus:
      "Algorithmic complexity, I/O hot spots, caching, concurrency, resource usage, and scalability risks.",
    guidance: [
      "Find super-linear work on inputs that grow: nested scans, repeated lookups, N+1 queries, unbounded buffering.",
      "Check I/O on hot paths: sync calls in request handlers, repeated reads, missing batching or pagination.",
      "Evaluate caching and concurrency for correctness before suggesting them.",
      "Without a benchmark or profile in the repository, label every finding a structural hypothesis, not measured runtime behavior.",
      "Reject micro-optimizations with no evidence the path is hot or the input large.",
    ],
  },
  reliability: {
    summary: "Failure handling, retries, cleanup, observability",
    focus:
      "Timeouts, retries, idempotency, partial failures, recovery, resource cleanup, concurrency, graceful degradation, and observability.",
    guidance: [
      "Trace failure paths across external calls, state changes, concurrency boundaries, and resource lifecycles.",
      "Check timeout, retry, cancellation, idempotency, cleanup, partial-failure, and recovery behavior where applicable.",
      "Evaluate whether errors and observability give operators enough context to detect and resolve failures.",
      "Reject hypothetical operational concerns not supported by concrete runtime behavior or evidence.",
    ],
  },
  architecture: {
    summary: "Boundaries, coupling, layering, data flow",
    focus:
      "System shape, module boundaries, coupling, entry points, data flow, domain/adapter/orchestration layering, and operational risks.",
    guidance: [
      "Identify whether business rules live in a framework-agnostic domain layer or are fused into one transport (route handler, controller, workflow step, queue consumer).",
      "Flag the same business rule reimplemented per transport instead of written once and called from each consumer.",
      "Flag domain logic importing framework types it does not need (HTTP objects, an ORM session, a workflow-engine context); those belong in a thin adapter.",
      "Flag orchestration introduced for logic with no durability, retry, or cross-service coordination need.",
      "Reject layering concerns not supported by concrete coupling or duplication visible in the code.",
    ],
  },
};

export function isProfile(value: string): value is Profile {
  return Object.hasOwn(profiles, value);
}

export function profileList(): Profile[] {
  return Object.keys(profiles) as Profile[];
}
