/**
 * Asks the server to settle markets that are due (it posts the Pyth update
 * and resolves; anyone could do the same). Returns the last signature.
 */
export async function settleMarkets(addresses: string[]): Promise<string | undefined> {
  let last: string | undefined;
  for (const market of addresses) {
    const res = await fetch("/api/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    last = body.signatures?.at(-1) ?? last;
  }
  return last;
}
