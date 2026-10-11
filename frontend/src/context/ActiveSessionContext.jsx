import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

const ActiveSessionContext = createContext(null)

export function ActiveSessionProvider({ children }) {
  const [activeSession, setActiveSession] = useState(null)
  const location = useLocation()

  // Clear or hide widget when currently viewing the active session page itself
  const isInsideSession = location.pathname.startsWith('/roleplay/session')

  const setSessionData = useCallback((data) => {
    setActiveSession(data)
  }, [])

  const clearSession = useCallback(() => {
    setActiveSession(null)
  }, [])

  const dismissSession = useCallback(() => {
    setActiveSession(null)
  }, [])

  return (
    <ActiveSessionContext.Provider
      value={{
        activeSession: isInsideSession ? null : activeSession,
        setSessionData,
        clearSession,
        dismissSession,
      }}
    >
      {children}
    </ActiveSessionContext.Provider>
  )
}

export function useActiveSession() {
  const ctx = useContext(ActiveSessionContext)
  if (!ctx) {
    return {
      activeSession: null,
      setSessionData: () => {},
      clearSession: () => {},
      dismissSession: () => {},
    }
  }
  return ctx
}
