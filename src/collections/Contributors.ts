import type { CollectionConfig } from 'payload'

export const Contributors: CollectionConfig = {
  slug: 'contributors',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'updatedAt'],
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
      name: 'profilePicture',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'twitterLink',
      type: 'text',
      admin: {
        description: 'Twitter/X profile URL',
      },
    },
    {
      name: 'discordLink',
      type: 'text',
      admin: {
        description: 'Discord profile URL',
      },
    },
    {
      name: 'githubLink',
      type: 'text',
      admin: {
        description: 'GitHub profile URL',
      },
    },
    {
      name: 'youtubeLink',
      type: 'text',
      admin: {
        description: 'YouTube channel URL',
      },
    },
    {
      name: 'linkedinLink',
      type: 'text',
      admin: {
        description: 'LinkedIn profile URL',
      },
    },
    {
      name: 'email',
      type: 'email',
    },
  ],
}
