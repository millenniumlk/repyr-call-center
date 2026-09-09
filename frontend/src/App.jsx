import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AgentDashboard from './pages/AgentDashboard';
import CustomerCall from './pages/CustomerCall';

export default function App() {
  return (
    <Routes>
      {/* Agent Portal */}
      <Route path="/dashboard" element={<AgentDashboard />} />

      {/* Customer Call Page — /c/:token */}
      <Route path="/c/:token" element={<CustomerCall />} />

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* 404 */}
      <Route
        path="*"
        element={
          <div className="flex items-center justify-center min-h-screen text-slate-400">
            <div className="text-center">
              <p className="text-6xl font-bold text-slate-600 mb-4">404</p>
              <p className="text-xl">Page not found</p>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
