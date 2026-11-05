const listeners: ((cityId: string) => void)[] = [];

/** 도시 데이터가 메모리에서 밀려날 때 불린다. 그 도시에서 파생한 캐시를 함께 비우는 데 쓴다. */
export function onCityEvict(cb: (cityId: string) => void): void {
  listeners.push(cb);
}

export function emitCityEvict(cityId: string): void {
  for (const cb of listeners) cb(cityId);
}
