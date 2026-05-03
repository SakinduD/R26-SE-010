import React from 'react'

export default function DashboardWidget({ title, value }){
  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}
