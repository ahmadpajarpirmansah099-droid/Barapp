const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
function getServiceRoleKey(): string {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (legacyKey) return legacyKey;
  try {
    const namedKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return typeof namedKeys.default === "string" ? namedKeys.default : "";
  } catch {
    return "";
  }
}
const SERVICE_ROLE_KEY = getServiceRoleKey();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

class RpcFailure extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function callRpc(name: string, args: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new RpcFailure("Konfigurasi server belum siap.", "CONFIG", 500);
  }
  const response = await fetch(
    SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + name,
    {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        ...(SERVICE_ROLE_KEY.startsWith("eyJ")
          ? { "Authorization": "Bearer " + SERVICE_ROLE_KEY }
          : {}),
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(args),
    },
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = String(payload?.code ?? "");
    const message = String(payload?.message ?? "");
    if (code === "P0001" || message.includes("Terlalu banyak permintaan")) {
      throw new RpcFailure("Terlalu banyak permintaan. Coba lagi dalam satu menit.", code, 429);
    }
    if (code === "P0002" || message.includes("Link antrean tidak valid")) {
      throw new RpcFailure("Link antrean tidak valid atau sudah dinonaktifkan.", code, 404);
    }
    if (code === "22023") {
      throw new RpcFailure(message || "Permintaan tidak valid.", code, 422);
    }
    throw new RpcFailure("Permintaan belum berhasil diproses. Coba lagi.", code || "RPC", 500);
  }
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { ok: false, error: "Metode permintaan tidak didukung." });

  try {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return respond(415, { ok: false, error: "Format permintaan tidak didukung." });
    }
    const raw = await req.text();
    if (raw.length > 4096) return respond(413, { ok: false, error: "Permintaan terlalu besar." });

    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); }
    catch { return respond(400, { ok: false, error: "Format permintaan tidak valid." }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond(400, { ok: false, error: "Format permintaan tidak valid." });
    }

    const token = typeof body.token === "string" ? body.token.toLowerCase() : "";
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return respond(404, { ok: false, error: "Link antrean tidak valid atau sudah dinonaktifkan." });
    }
    if (String(body.action ?? "") !== "ticket") {
      return respond(400, { ok: false, error: "Aksi permintaan tidak valid." });
    }

    const ticket = await callRpc("guest_arrival_public_ticket", { p_token: token });
    return respond(200, {
      ok: true,
      ticket: {
        queue_number: ticket.queue_number,
        queue_code: ticket.queue_code,
        status: ticket.status,
        packs: ticket.packs,
        operational_date: ticket.operational_date,
        arrived_at: ticket.arrived_at,
        outlet_code: ticket.outlet_code,
        outlet_name: ticket.outlet_name,
      },
    });
  } catch (error) {
    const err = error instanceof RpcFailure
      ? error
      : new RpcFailure("Layanan antrean sedang bermasalah. Coba lagi.", "INTERNAL", 500);
    console.error("guest-arrival-public request failed", { code: err.code, status: err.status });
    return respond(err.status, { ok: false, error: err.message });
  }
});
