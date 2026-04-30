import React from 'react'
import Button from '../../../components/ui/Button'

export default function LoginPage(){
  return (
    <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded shadow">
      <h2 className="text-xl font-medium mb-4">Sign in</h2>
      <label className="block mb-2">Email
        <input className="w-full mt-1 p-2 border rounded" type="email" />
      </label>
      <label className="block mb-4">Password
        <input className="w-full mt-1 p-2 border rounded" type="password" />
      </label>
      <Button>Sign in</Button>
    </div>
  )
}
