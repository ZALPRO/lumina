// formats/deflate.js — inflate/deflate مشترک (Node zlib ↔ DecompressionStream مرورگر)
// چرا: کد باید هم در Node (تست/CLI/الکترون) و هم در مرورگر اجرا شود.
// هرگز import استاتیک 'node:zlib' نکنید — در مرورگر CORS می‌شکند.

export const isNode = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

export async function inflateZlib(bytes) {
  if (isNode) {
    const zlib = await import('node:zlib');
    return new Promise((res, rej) => zlib.inflate(Buffer.from(bytes), (e, b) => (e ? rej(e) : res(new Uint8Array(b)))));
  }
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflateZlib(bytes, level = 6) {
  if (isNode) {
    const zlib = await import('node:zlib');
    return new Promise((res, rej) => zlib.deflate(Buffer.from(bytes), { level }, (e, b) => (e ? rej(e) : res(new Uint8Array(b)))));
  }
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
