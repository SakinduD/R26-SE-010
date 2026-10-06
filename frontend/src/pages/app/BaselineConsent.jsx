import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute'
import CaptureConsent, { saveCaptureConsent } from '@/components/MCA/CaptureConsent'

const DECISION_KEY = 'empowerz:baseline:decision'

export default function BaselineConsent() {
  const { isLoading: authLoading } = useProtectedRoute()
  const navigate = useNavigate()
  const [skipping, setSkipping] = useState(false)

  function handleConsent() {
    saveCaptureConsent('baseline')
    localStorage.setItem(DECISION_KEY, 'consented')
    navigate('/baseline')
  }

  function handleSkip() {
    setSkipping(true)
    localStorage.setItem(DECISION_KEY, 'skipped')
    navigate('/training-plan')
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '50vh', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={24} strokeWidth={1.6} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
      </div>
    )
  }

  return (
    <CaptureConsent
      mode="baseline"
      onAccept={handleConsent}
      onDecline={handleSkip}
      declining={skipping}
    />
  )
}
