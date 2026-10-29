import fc from "fast-check";

// Property runs that fail on a heavy generator (200-step market histories) can shrink for
// minutes. Cap the total time per property instead; an interrupt still counts as a failure,
// so nothing is hidden, and the best counterexample found so far is reported.
fc.configureGlobal({
  interruptAfterTimeLimit: 30_000,
  markInterruptAsFailure: true,
});
