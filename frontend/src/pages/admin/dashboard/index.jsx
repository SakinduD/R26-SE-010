import React from 'react'
import DashboardWidget from '../../../components/admin/DashboardWidget'

export default function AdminDashboard(){
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Admin / Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DashboardWidget title="Users" value="1,234" />
        <DashboardWidget title="Sales" value="$12,345" />
        <DashboardWidget title="Errors" value="2" />
      </div>
    </div>
  )
}
