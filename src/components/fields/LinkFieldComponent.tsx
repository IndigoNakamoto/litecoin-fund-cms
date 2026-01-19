'use client'

import React from 'react'
import { TextInput, FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'

export const LinkFieldComponent: TextFieldClientComponent = (props) => {
  const { path, field } = props
  const { value, setValue } = useField<string>({ path })
  
  // Ensure the URL has a protocol
  const getUrlWithProtocol = (url: string | null | undefined): string => {
    if (!url) return ''
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    if (url.startsWith('mailto:')) {
      return url
    }
    return `https://${url}`
  }

  const url = value ? getUrlWithProtocol(value) : null
  const label = field.label || field.name
  const required = field.required
  const description = typeof field.admin?.description === 'string' 
    ? field.admin.description 
    : null

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: '0.5rem' }}>
        <FieldLabel 
          label={label} 
          required={required}
        />
      </div>
      {description && (
        <div style={{ 
          marginBottom: '0.5rem', 
          fontSize: '0.875rem', 
          color: '#666',
          fontStyle: 'italic'
        }}>
          {description}
        </div>
      )}
      <TextInput
        path={path}
        value={value || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        label={undefined}
        required={required}
      />
      {url && (
        <div style={{ 
          marginTop: '0.75rem', 
          fontSize: '0.875rem',
          padding: '0.5rem',
          backgroundColor: '#f0f7ff',
          borderRadius: '4px',
          border: '1px solid #e0e7ff'
        }}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#0066cc',
              textDecoration: 'none',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textDecoration = 'underline'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = 'none'
            }}
          >
            <span>🔗</span>
            <span>Open link: {url}</span>
          </a>
        </div>
      )}
    </div>
  )
}
