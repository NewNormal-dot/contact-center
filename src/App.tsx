/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './features/auth/Login';
import AdminDashboard from './features/dashboard/AdminDashboard';
import CsrDashboard from './features/dashboard/CsrDashboard';
import SuperAdminDashboard from './features/dashboard/SuperAdminDashboard';
import { AuthProvider, useAuth } from './contexts/AuthContext';

function ProtectedRoute({ children, role }: { children: React.ReactNode, role?: string }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Уншиж байна...</div>;
  if (!user) return <Navigate to="/" replace />;

  const hasAccess = !role || user.role === role || (role === 'admin' && user.role === 'superadmin');
  if (!hasAccess) return <Navigate to="/" replace />;

  return <>{children}</>;
}

function HomeOrLogin() {
  const { user } = useAuth();

  if (user) {
    const redirectPath = user.role === 'superadmin'
      ? '/superadmin'
      : user.role === 'admin'
      ? '/admin'
      : '/csr';

    return <Navigate to={redirectPath} replace />;
  }

  return <Login />;
}

export default function App() {
  React.useEffect(() => {
    const theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeOrLogin />} />
          <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/csr" element={<ProtectedRoute role="csr"><CsrDashboard /></ProtectedRoute>} />
          <Route path="/superadmin" element={<ProtectedRoute role="superadmin"><SuperAdminDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
