import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import MultimodalEngine from './pages/MCA/MultimodalEngine'
import AdminDashboard from './pages/admin/dashboard'
import AnalyticsDashboard from './pages/Analytics/AnalyticsDashboard'
import FeedbackForm from './pages/Analytics/FeedbackForm'
import PostSessionReport from './pages/Analytics/PostSessionReport'
import PredictiveAnalytics from './pages/Analytics/PredictiveAnalytics'
import SkillTwinProfile from './pages/Analytics/SkillTwinProfile'

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
          <Route path="/analytics-dashboard" element={<AnalyticsDashboard />} />
          <Route path="/analytics-feedback" element={<FeedbackForm />} />
          <Route path="/analytics/sessions/:sessionId/feedback" element={<FeedbackForm />} />
          <Route path="/analytics-skill-twin" element={<SkillTwinProfile />} />
          <Route path="/analytics/users/:userId/skill-twin" element={<SkillTwinProfile />} />
          <Route path="/analytics-predictions" element={<PredictiveAnalytics />} />
          <Route path="/analytics/users/:userId/predictions" element={<PredictiveAnalytics />} />
          <Route path="/analytics-session-report" element={<PostSessionReport />} />
          <Route path="/analytics/sessions/:sessionId/report" element={<PostSessionReport />} />
        </Routes>
      </div>
    </Router>
  )
}
