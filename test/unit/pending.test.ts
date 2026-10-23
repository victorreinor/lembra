import { expect, test } from "bun:test";
import { describeReasons, pendingReasons, type BranchFacts } from "../../src/core/pending";

const pushed: BranchFacts = { exists: true, upstream: true, ahead: 0, dirty: false, pr: "OPEN" };

test("a merged or deleted branch is never pending", () => {
  expect(pendingReasons({ ...pushed, pr: "MERGED", upstream: false })).toEqual([]);
  expect(pendingReasons({ ...pushed, exists: false, pr: "NONE" })).toEqual([]);
});

test("an open PR counts as delivered", () => {
  expect(pendingReasons(pushed)).toEqual([]);
});

test("lists every reason the work is not delivered yet", () => {
  expect(pendingReasons({ ...pushed, upstream: false, dirty: true, pr: "NONE" })).toEqual(["no-push", "dirty", "no-pr"]);
  expect(pendingReasons({ ...pushed, ahead: 3, pr: "CLOSED" })).toEqual(["ahead", "pr-closed"]);
});

test("unknown PR state (no gh) does not invent a missing PR", () => {
  expect(pendingReasons({ ...pushed, pr: "UNKNOWN" })).toEqual([]);
});

test("describeReasons spells out how many commits are unpushed", () => {
  expect(describeReasons({ reasons: ["ahead", "no-pr"], facts: { ...pushed, ahead: 3 } })).toEqual(["3 commits sem push", "sem PR"]);
});
