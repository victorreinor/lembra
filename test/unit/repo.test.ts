import { expect, test } from "bun:test";
import { repoFromRemote } from "../../src/core/repo";

test("repoFromRemote reads owner/name from ssh and https remotes", () => {
  expect(repoFromRemote("git@github.com:acme/billing-api.git\n")).toBe("acme/billing-api");
  expect(repoFromRemote("https://github.com/victorreinor/lembra.git")).toBe("victorreinor/lembra");
  expect(repoFromRemote("https://gitlab.com/group/project/")).toBe("group/project");
  expect(repoFromRemote("not a remote")).toBeUndefined();
});
