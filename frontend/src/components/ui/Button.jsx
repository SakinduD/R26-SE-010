import React from 'react'

export default function Button({ children, className = '', ...props }){
  return (
    <button
      className={"inline-flex items-center gap-2 px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 " + className}
      {...props}
    >
      {children}
    </button>
  )
}
