/**
 * Public Querily Labs contact endpoint.
 * Deploy with `supabase functions deploy contact-submit --no-verify-jwt`.
 * CAPTCHA + strict origin allowlist + atomic database rate limiting protect this public endpoint.
 * API keys and the service-role key are NEVER sent to the browser.
 */
import { createClient } from "@supabase/supabase-js";

type ContactPayload = {
  topic?: unknown;
  name?: unknown;
  email?: unknown;
  message?: unknown;
  website?: unknown; // honeypot
  turnstileToken?: unknown;
};

const TOPICS = new Set([
  "Request a demo",
  "Explore an institutional pilot",
  "Research or strategic collaboration",
  "General inquiry",
]);
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
const origins = () => new Set((env("ALLOWED_ORIGINS") || "https://querilylabs.com,https://www.querilylabs.com")
  .split(",").map(s => s.trim()).filter(Boolean));
const allowedHostnames = () => new Set((env("TURNSTILE_ALLOWED_HOSTNAMES") || "querilylabs.com,www.querilylabs.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean));

function response(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "600",
    },
  });
}

async function parseLimitedJson(req: Request): Promise<ContactPayload> {
  const maxBytes = 12_000;
  const reader = req.body?.getReader();
  if (!reader) throw new Error("empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("request too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(combined));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid payload");
  return parsed as ContactPayload;
}

async function hashRateKey(ip: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (!origins().has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  if (req.method === "OPTIONS") return response(origin, 204, {});
  if (req.method !== "POST") return response(origin, 405, { error: "Method not allowed" });
  if (!(req.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return response(origin, 415, { error: "Expected JSON" });
  }

  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "RATE_LIMIT_PEPPER", "CONTACT_FROM", "CONTACT_TO"];
  if (required.some(key => !env(key))) {
    console.error("Contact endpoint configuration incomplete");
    return response(origin, 503, { error: "Contact form is temporarily unavailable" });
  }

  let payload: ContactPayload;
  try { payload = await parseLimitedJson(req); }
  catch { return response(origin, 400, { error: "Invalid or oversized submission" }); }

  // Honeypot: automated spam can receive a neutral response without sending email.
  if (typeof payload.website === "string" && payload.website.trim()) return response(origin, 200, { ok: true });

  const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const token = typeof payload.turnstileToken === "string" ? payload.turnstileToken.trim() : "";

  if (!TOPICS.has(topic) || name.length < 2 || name.length > 120 ||
      !emailPattern.test(email) || email.length > 254 ||
      message.length < 10 || message.length > 4000 || token.length < 10 || token.length > 2048) {
    return response(origin, 400, { error: "Please complete all fields and the security check" });
  }
 const hasInvalidControls = (value: string): boolean => {
  return Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
};

if (hasInvalidControls(name) || hasInvalidControls(email)) {
  return response(origin, 400, { error: "Invalid name or email" });
}

  // Only trust the edge-proxy's IP header. If absent, share one conservative bucket.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map(s => s.trim()).filter(Boolean).at(-1);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || forwarded || "unknown";
  const bucketKey = await hashRateKey(ip, env("RATE_LIMIT_PEPPER"));
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: allowed, error: rateError } = await supabase.rpc("contact_rate_limit_check", {
      p_key: bucketKey, p_max: 5, p_window_seconds: 900,
    });
    if (rateError) {
      console.error("Rate limiter unavailable", rateError.code);
      return response(origin, 503, { error: "Contact form is temporarily unavailable" });
    }
    if (!allowed) return response(origin, 429, { error: "Too many requests. Please try again later." });
  } catch {
    return response(origin, 503, { error: "Contact form is temporarily unavailable" });
  }

  // Cloudflare Turnstile verification must occur server-side.
  let captchaOk = false;
  try {
    const params = new URLSearchParams({ secret: env("TURNSTILE_SECRET_KEY"), response: token });
    if (ip !== "unknown") params.set("remoteip", ip);
    const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: params, signal: AbortSignal.timeout(8000),
    });
    if (check.ok) {
      const result = await check.json() as { success?: boolean; hostname?: string };
      captchaOk = result.success === true && allowedHostnames().has((result.hostname || "").toLowerCase());
    }
  } catch { /* Do not bypass the CAPTCHA if the provider is unavailable. */ }
  if (!captchaOk) return response(origin, 403, { error: "Security check failed. Please try again." });

  // Persist a private inquiry record before requesting email delivery.
  const { data: inquiry, error: inquiryError } = await supabase
    .from("contact_inquiries")
    .insert({ topic, sender_name: name, sender_email: email, message, email_status: "pending" })
    .select("id")
    .single();
  if (inquiryError || !inquiry?.id) {
    console.error("Contact inquiry could not be stored", inquiryError?.code);
    return response(origin, 503, { error: "Unable to submit your message right now." });
  }

  const inquiryId = inquiry.id;

  async function updateDelivery(status: "accepted" | "failed", resendId?: string, error?: string) {
    const { error: updateError } = await supabase.from("contact_inquiries").update({
      email_status: status,
      resend_message_id: resendId ?? null,
      email_error: error ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", inquiryId);
    if (updateError) console.error("Contact delivery status update failed", updateError.code);
  }

  const text = [
    "New inquiry from the Querily Labs website", "",
    `Inquiry: ${topic}`, `Name: ${name}`, `Email: ${email}`, "",
    "Message:", message,
  ].join("\n");

  try {
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env("CONTACT_FROM"),
        to: [env("CONTACT_TO")],
        reply_to: email,
        subject: `Querily Labs | ${topic}`,
        text,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!send.ok) {
      console.error("Email provider rejected contact message", send.status);
      await updateDelivery("failed", undefined, `Resend HTTP ${send.status}`);
      return response(origin, 502, { error: "Message recorded, but email notification failed. Please contact us directly." });
    }
    const result = await send.json() as { id?: string };
    if (!result.id) {
      await updateDelivery("failed", undefined, "Resend response missing message id");
      return response(origin, 502, { error: "Message recorded, but email notification could not be confirmed." });
    }
    await updateDelivery("accepted", result.id);
    return response(origin, 200, { ok: true, message: "Message submitted successfully." });
  } catch {
    await updateDelivery("failed", undefined, "Email request failed or timed out");
    return response(origin, 502, { error: "Message recorded, but email notification is temporarily unavailable." });
  }
});
