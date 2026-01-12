import { useNavigate } from "react-router-dom";
import { signOut } from "@/lib/auth";

export default function AdminHome() {
  const nav = useNavigate();

  return (
    <div style={{ maxWidth: 900, margin: "60px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin</h1>
        <button
          onClick={async () => {
            await signOut();
            nav("/admin/login", { replace: true });
          }}
          style={{ padding: 10, borderRadius: 10 }}
        >
          Sign out
        </button>
      </div>

      <p style={{ opacity: 0.7 }}>
        Next: we’ll add “Create Post / Edit Post / Publish”.
      </p>
    </div>
  );
}
