import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithPassword } from "@/lib/auth";

export default function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signInWithPassword(email.trim(), password);
      nav("/admin", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 6 }}>Admin Login</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>Sign in to manage posts.</p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
          required
          style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,.2)" }}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          autoComplete="current-password"
          required
          style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,.2)" }}
        />

        {err && (
          <div style={{ padding: 10, borderRadius: 10, background: "rgba(255,0,0,.08)" }}>
            {err}
          </div>
        )}

        <button
          disabled={busy}
          type="submit"
          style={{
            padding: 12,
            borderRadius: 12,
            border: 0,
            cursor: "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
