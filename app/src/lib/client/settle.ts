/**
 * Asks the server to settle due markets (it posts the Pyth update once per
 * ladder and resolves each strike; anyone could do the same). Returns the
 * last signature.
 */
export async function settleMarkets(addresses: string[]): Promise<string | undefined> {
  const res = await fetch("/api/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markets: addresses }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(res.status === 425 ? `Pyth hasn't published the deadline print yet. Try again in a few seconds.` : body.error);
  return body.signatures?.at(-1);
}
