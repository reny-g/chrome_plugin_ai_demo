# Development Workflow

## Default Delivery Mode

Use a lightweight, risk-based workflow by default.

1. Write one feature-level spec when requirements or behavior need design clarification.
2. Write one feature-level implementation plan for multi-step work.
3. Reuse the approved spec and plan across implementation tasks. Do not create a new spec or plan for every task.
4. Use TDD for core logic, bug fixes, parsers, data transformations, contracts, concurrency, and other behavior with meaningful regression risk.
5. Simple UI wiring, styling, labels, and mechanical integration do not require a forced RED/GREEN cycle when a focused syntax, unit, browser, or end-to-end check provides adequate evidence.
6. Keep task commits small and independently understandable when practical.
7. Perform local self-review and targeted verification after each task.
8. Perform one full code review and one complete verification pass after the feature is integrated.

## Agent Usage

Do not use a separate implementer, spec reviewer, and code-quality reviewer for every small task by default.

Use subagents when they materially help with:

- independent work that can run in parallel;
- complex or high-risk implementation;
- broad code review;
- specialized investigation.

For straightforward sequential tasks, implement and review in the current session. Avoid repeated review loops that add cost without proportionate risk reduction.

## Verification

Claims must be supported by fresh evidence.

- Run focused tests while developing.
- Run the complete relevant test suite before completion.
- Verify browser-extension behavior in a real Chrome environment for user-facing workflows.
- Preserve unrelated user changes and exclude them from feature commits.
