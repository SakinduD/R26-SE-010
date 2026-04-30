import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import MultimodalEngine from './pages/MCA/MultimodalEngine'
import AdminDashboard from './pages/admin/dashboard'

export default function App(){
  return (
    <Router>
      <div className="min-h-screen">
        <Routes>
          <Route path="/" element={
            <div className="bg-gray-50 p-6 min-h-screen">
              <AdminDashboard />
            </div>
          } />
          <Route path="/multimodal-analysis" element={<MultimodalEngine />} />
        </Routes>
      </div>
    </Router>
  )
}
