import { describe, expect, it } from "vitest";
import { takeQuota } from "../src/limit";
import { FakeKV } from "./helpers";

const kv = () => new FakeKV() as unknown as KVNamespace;
const day = new Date("2026-11-05T10:00:00Z");

describe("takeQuota", () => {
  it("IP당 한도", async () => {
    const k = kv();
    for (let i = 0; i < 5; i++) expect(await takeQuota(k, "a", day, 5, 300)).toBe(true);
    expect(await takeQuota(k, "a", day, 5, 300)).toBe(false);
    expect(await takeQuota(k, "b", day, 5, 300)).toBe(true);
  });
  it("전체 한도", async () => {
    const k = kv();
    expect(await takeQuota(k, "a", day, 5, 2)).toBe(true);
    expect(await takeQuota(k, "b", day, 5, 2)).toBe(true);
    expect(await takeQuota(k, "c", day, 5, 2)).toBe(false);
  });
  it("UTC 날짜별 키와 TTL", async () => {
    const f = new FakeKV();
    const k = f as unknown as KVNamespace;
    await takeQuota(k, "a", day, 5, 300);
    expect([...f.store.keys()].sort()).toEqual(["rl:all:2026-11-05", "rl:ip:2026-11-05:a"].sort().map((x) => x));
    expect(f.ttl.get("rl:all:2026-11-05")).toBe(172800);
    expect(await takeQuota(k, "a", new Date("2026-11-06T00:00:01Z"), 5, 300)).toBe(true);
  });
});
