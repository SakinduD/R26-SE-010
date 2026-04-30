import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import MultimodalEngine from './pages/MCA/MultimodalEngine'
import AdminDashboard from './pages/admin/dashboard'

export default function App(){
  return (
    <Router>
      <div className="min-h-screen dark bg-background text-foreground antialiased">
        <Routes>
          <Route path="/" element={
            <div className="bg-muted/30 p-6 min-h-screen">
              <AdminDashboard />
            </div>
          } />
          <Route path="/multimodal-analysis" element={<MultimodalEngine />} />
        </Routes>
      </div>
    </Router>
  )
}
