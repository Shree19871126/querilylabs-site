import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getSession, onAuthStateChange } from "@/lib/auth";

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const session = await getSession();
      if (!mounted) return;
      setAuthed(!!session);
      setLoading(false);
    };

    load();

    const sub = onAuthStateChange(() => load());
    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  if (loading) return null; // keep minimal; replace with spinner if you want
  if (!authed) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
