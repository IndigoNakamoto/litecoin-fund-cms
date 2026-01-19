import type { CollectionConfig } from 'payload'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'status', 'updatedAt'],
  },
  access: {
    read: () => true,
    update: () => true, // Allow updates for migration scripts
    create: () => true, // Allow creates for migration scripts
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'URL-friendly identifier',
      },
    },
    {
      name: 'summary',
      type: 'textarea',
      required: true,
    },
    {
      name: 'content',
      type: 'richText',
      admin: {
        description: 'Full project description/content',
      },
    },
    {
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Completed', value: 'completed' },
        { label: 'Paused', value: 'paused' },
        { label: 'Archived', value: 'archived' },
      ],
      defaultValue: 'active',
    },
    {
      name: 'projectType',
      type: 'select',
      options: [
        { label: 'Open Source', value: 'open-source' },
        { label: 'Research', value: 'research' },
        { label: 'Education', value: 'education' },
        { label: 'Infrastructure', value: 'infrastructure' },
      ],
    },
    {
      name: 'hidden',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Hide project from public listings',
      },
    },
    {
      name: 'recurring',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Is this a recurring project?',
      },
    },
    {
      name: 'totalPaid',
      type: 'number',
      admin: {
        description: 'Total amount paid to project',
      },
      defaultValue: 0,
    },
    {
      name: 'serviceFeesCollected',
      type: 'number',
      admin: {
        description: 'Service fees collected',
      },
      defaultValue: 0,
    },
    // Social Links
    {
      name: 'website',
      type: 'text',
      admin: {
        description: 'Website URL',
      },
    },
    {
      name: 'github',
      type: 'text',
      admin: {
        description: 'GitHub repository URL',
      },
    },
    {
      name: 'twitter',
      type: 'text',
      admin: {
        description: 'Twitter/X profile URL',
      },
    },
    {
      name: 'discord',
      type: 'text',
      admin: {
        description: 'Discord server URL',
      },
    },
    {
      name: 'telegram',
      type: 'text',
      admin: {
        description: 'Telegram channel/group URL',
      },
    },
    {
      name: 'reddit',
      type: 'text',
      admin: {
        description: 'Reddit community URL',
      },
    },
    {
      name: 'facebook',
      type: 'text',
      admin: {
        description: 'Facebook page URL',
      },
    },
    // Contributors
    {
      name: 'bitcoinContributors',
      type: 'relationship',
      relationTo: 'contributors',
      hasMany: true,
      admin: {
        description: 'Bitcoin contributors to this project',
      },
    },
    {
      name: 'litecoinContributors',
      type: 'relationship',
      relationTo: 'contributors',
      hasMany: true,
      admin: {
        description: 'Litecoin contributors to this project',
      },
    },
    {
      name: 'advocates',
      type: 'relationship',
      relationTo: 'contributors',
      hasMany: true,
      admin: {
        description: 'Project advocates',
      },
    },
    {
      name: 'hashtags',
      type: 'array',
      fields: [
        {
          name: 'tag',
          type: 'text',
        },
      ],
    },
  ],
}
