import { Routes, Route } from "react-router-dom";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminHome from "./pages/admin/AdminHome";
import AdminGate from "./components/AdminGate";

export default function App() {
  return (
    <Routes>
      {/* your public routes... */}

      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <AdminGate>
            <AdminHome />
          </AdminGate>
        }
      />
    </Routes>
  );
}
