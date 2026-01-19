'use client'

import React from 'react'

type ContributorDetailViewProps = {
  data?: {
    twitterLink?: string | null
    discordLink?: string | null
    githubLink?: string | null
    youtubeLink?: string | null
    linkedinLink?: string | null
    email?: string | null
  }
}

export const ContributorDetailView: React.FC<ContributorDetailViewProps> = ({ data }) => {
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

  const links = [
    { label: 'Twitter', url: data?.twitterLink, icon: '🐦' },
    { label: 'Discord', url: data?.discordLink, icon: '💬' },
    { label: 'GitHub', url: data?.githubLink, icon: '💻' },
    { label: 'YouTube', url: data?.youtubeLink, icon: '📺' },
    { label: 'LinkedIn', url: data?.linkedinLink, icon: '💼' },
    { label: 'Email', url: data?.email ? `mailto:${data.email}` : null, icon: '📧' },
  ].filter((link) => link.url)

  if (links.length === 0) {
    return null
  }

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '4px' }}>
      <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', fontWeight: 600 }}>Links:</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {links.map((link) => {
          const url = getUrlWithProtocol(link.url)
          return (
            <a
              key={link.label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: '#0066cc',
                textDecoration: 'none',
                fontSize: '0.875rem',
                padding: '0.25rem 0',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecoration = 'underline'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = 'none'
              }}
            >
              <span>{link.icon}</span>
              <span>{link.label}: {link.url}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
