// Order ids carry their own small state, so creating an order stores nothing anywhere:
// 16 bytes hex; the last byte's bit 0 = network (1 chipnet), bit 1 = careless specialist (1 lena).
export type OrderMeta = { id: string; net: 'mainnet' | 'chipnet'; careless: 'sam' | 'lena' };

export function newOrderId(net: OrderMeta['net'], careless: OrderMeta['careless']): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[15] = (b[15]! & 0xfc) | (net === 'chipnet' ? 1 : 0) | (careless === 'lena' ? 2 : 0);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function readOrderId(id: string): OrderMeta | null {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const last = parseInt(id.slice(30), 16);
  return { id, net: last & 1 ? 'chipnet' : 'mainnet', careless: last & 2 ? 'lena' : 'sam' };
}
