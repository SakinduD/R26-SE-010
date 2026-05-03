import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'

// Auth infrastructure
import { AuthProvider } from './lib/auth/context'

// Layouts
import AuthLayout from './pages/auth/AuthLayout'
import AppLayout from './pages/app/AppLayout'

// Auth pages
import Landing from './pages/Landing'
import SignUp from './pages/auth/SignUp'
import SignIn from './pages/auth/SignIn'
import ForgotPassword from './pages/auth/ForgotPassword'
import VerifyEmail from './pages/auth/VerifyEmail'
import AuthCallback from './pages/auth/AuthCallback'

// Protected app pages
import Dashboard from './pages/app/Dashboard'

// Existing feature pages
import MultimodalEngine from './pages/MCA/MultimodalEngine'
import AdminDashboard from './pages/admin/dashboard'
import AnalyticsDashboard from './pages/Analytics/AnalyticsDashboard'
import AnalyticsRecommendations from './pages/Analytics/AnalyticsRecommendations'
import BlindSpotDetail from './pages/Analytics/BlindSpotDetail'
import FeedbackForm from './pages/Analytics/FeedbackForm'
import PostSessionReport from './pages/Analytics/PostSessionReport'
import PredictiveAnalytics from './pages/Analytics/PredictiveAnalytics'
import ProgressTrendsDetail from './pages/Analytics/ProgressTrendsDetail'
import SkillTwinProfile from './pages/Analytics/SkillTwinProfile'

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster position="top-center" richColors closeButton />

        <div className="min-h-screen bg-background text-foreground antialiased">
          <Routes>
            {/* Public landing */}
            <Route path="/" element={<Landing />} />

            {/* Auth flow (shared AuthLayout: centered card + background gradient) */}
            <Route element={<AuthLayout />}>
              <Route path="/signup" element={<SignUp />} />
              <Route path="/signin" element={<SignIn />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
            </Route>

            {/* Auth callback — no layout chrome */}
            <Route path="/auth-callback" element={<AuthCallback />} />

            {/* Protected app routes (AppLayout checks auth + renders nav) */}
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
            </Route>

            {/* Legacy / feature routes (unchanged) */}
            <Route path="/admin" element={
              <div className="dark bg-background text-foreground min-h-screen">
                <div className="bg-muted/30 p-6 min-h-screen">
                  <AdminDashboard />
                </div>
              </div>
            } />
            <Route path="/multimodal-analysis" element={<MultimodalEngine />} />
            <Route path="/analytics-dashboard" element={<AnalyticsDashboard />} />
            <Route path="/analytics-recommendations" element={<AnalyticsRecommendations />} />
            <Route path="/analytics/users/:userId/recommendations" element={<AnalyticsRecommendations />} />
            <Route path="/analytics-feedback" element={<FeedbackForm />} />
            <Route path="/analytics/sessions/:sessionId/feedback" element={<FeedbackForm />} />
            <Route path="/analytics-skill-twin" element={<SkillTwinProfile />} />
            <Route path="/analytics/users/:userId/skill-twin" element={<SkillTwinProfile />} />
            <Route path="/analytics-predictions" element={<PredictiveAnalytics />} />
            <Route path="/analytics/users/:userId/predictions" element={<PredictiveAnalytics />} />
            <Route path="/analytics-blind-spots" element={<BlindSpotDetail />} />
            <Route path="/analytics/users/:userId/blind-spots" element={<BlindSpotDetail />} />
            <Route path="/analytics/sessions/:sessionId/blind-spots" element={<BlindSpotDetail />} />
            <Route path="/analytics-progress-trends" element={<ProgressTrendsDetail />} />
            <Route path="/analytics/users/:userId/progress" element={<ProgressTrendsDetail />} />
            <Route path="/analytics-session-report" element={<PostSessionReport />} />
            <Route path="/analytics/sessions/:sessionId/report" element={<PostSessionReport />} />
          </Routes>
        </div>
      </AuthProvider>
    </Router>
  )
}
