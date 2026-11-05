const TTL_SECONDS = 172800;

async function read(kv: KVNamespace, key: string): Promise<number> {
  const n = Number.parseInt((await kv.get(key)) ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

// KV는 최종 일관성이라 동시 요청에서 약간 넘칠 수 있다. 비용 방어용으로는 충분하다.
export async function takeQuota(kv: KVNamespace, ip: string, now: Date, perIp: number, total: number): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const ipKey = `rl:ip:${day}:${ip}`;
  const allKey = `rl:all:${day}`;
  const [ipCount, allCount] = await Promise.all([read(kv, ipKey), read(kv, allKey)]);
  if (ipCount >= perIp || allCount >= total) return false;
  await Promise.all([
    kv.put(ipKey, String(ipCount + 1), { expirationTtl: TTL_SECONDS }),
    kv.put(allKey, String(allCount + 1), { expirationTtl: TTL_SECONDS }),
  ]);
  return true;
}
