const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
function getServiceRoleKey(): string {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (legacyKey) return legacyKey;
  // Support current named secret-key environment variables while retaining legacy compatibility.
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
        "Authorization": "Bearer " + SERVICE_ROLE_KEY,
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
      throw new RpcFailure(message || "Data formulir tidak valid.", code, 422);
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
    if (raw.length > 8192) return respond(413, { ok: false, error: "Permintaan terlalu besar." });

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

    const action = String(body.action ?? "");
    if (action === "outlet") {
      const outlet = await callRpc("guest_arrival_public_outlet", { p_token: token });
      return respond(200, { ok: true, outlet });
    }
    if (action !== "create") return respond(400, { ok: false, error: "Aksi permintaan tidak valid." });
    if (String(body.website ?? "").trim()) {
      return respond(422, { ok: false, error: "Formulir tidak dapat diproses." });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const packs = Number(body.packs);
    const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const smokingPreference = String(body.smoking_preference ?? "Non Smoking");
    const requestId = String(body.request_id ?? "");

    if (name.length < 2 || name.length > 80) return respond(422, { ok: false, error: "Nama wajib diisi (2–80 karakter)." });
    if (!Number.isInteger(packs) || packs < 1 || packs > 50) return respond(422, { ok: false, error: "Jumlah tamu harus antara 1 sampai 50 orang." });
    if (whatsapp.length > 32 || note.length > 300) return respond(422, { ok: false, error: "Nomor kontak atau catatan terlalu panjang." });
    if (!["Non Smoking", "Smoking"].includes(smokingPreference)) return respond(422, { ok: false, error: "Preferensi tidak valid." });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return respond(422, { ok: false, error: "ID permintaan tidak valid. Muat ulang halaman." });
    }

    const ticket = await callRpc("guest_arrival_public_create", {
      p_token: token,
      p_name: name,
      p_packs: packs,
      p_whatsapp: whatsapp || null,
      p_smoking_preference: smokingPreference,
      p_note: note || null,
      p_request_id: requestId,
    });

    return respond(200, {
      ok: true,
      ticket: {
        queue_number: ticket.queue_number,
        queue_code: ticket.queue_code,
        status: ticket.status,
        operational_date: ticket.operational_date,
        outlet_code: ticket.outlet_code,
        outlet_name: ticket.outlet_name,
        duplicate_request: Boolean(ticket.duplicate_request),
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
